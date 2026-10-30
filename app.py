import ast
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from functools import wraps
from pathlib import Path

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from database import (
    get_all_questions,
    get_daily_question_archive,
    get_db,
    get_or_create_daily_question,
    get_question,
    get_user,
    init_db,
    record_submission,
    user_stats,
)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "change-this-secret-key")
init_db()

oauth = OAuth(app)
GOOGLE_OAUTH_ENABLED = bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))
GITHUB_OAUTH_ENABLED = bool(os.getenv("GITHUB_CLIENT_ID") and os.getenv("GITHUB_CLIENT_SECRET"))

if GOOGLE_OAUTH_ENABLED:
    oauth.register(
        name="google",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

if GITHUB_OAUTH_ENABLED:
    oauth.register(
        name="github",
        client_id=os.environ["GITHUB_CLIENT_ID"],
        client_secret=os.environ["GITHUB_CLIENT_SECRET"],
        authorize_url="https://github.com/login/oauth/authorize",
        access_token_url="https://github.com/login/oauth/access_token",
        api_base_url="https://api.github.com/",
        client_kwargs={"scope": "user:email"},
    )


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def get_question_from_ai():
    try:
        from google import genai

        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return None, "Gemini API key is missing. Add GEMINI_API_KEY to your .env file."

        client = genai.Client(api_key=api_key)
        today_label = time.strftime("%Y-%m-%d")
        prompt = f"""
Generate ONE original beginner-friendly coding practice question for {today_label}.
The question must be different from common classics like Two Sum, Valid Parentheses, Merge Intervals, and FizzBuzz.
It should be solvable with a single Python function and have clear examples for a new programmer.
Return ONLY valid JSON with this exact shape:
{{
  "title": "",
  "difficulty": "Easy | Medium | Hard",
  "description": "",
  "example_input": "variable assignments, one per line, e.g. nums = [2,7,11,15]\\ntarget = 9",
  "example_output": "the expected return value as a Python literal string",
  "hidden_input": "a second test case using the same variable format",
  "hidden_output": "expected output for hidden_input",
  "constraints": [],
  "function_signature": "def function_name(param1, param2):"
}}
"""
        response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        text = response.text.strip().replace("```json", "").replace("```", "").strip()
        data = json.loads(text)
        required = {
            "title",
            "difficulty",
            "description",
            "example_input",
            "example_output",
            "hidden_input",
            "hidden_output",
            "constraints",
            "function_signature",
        }
        if not required.issubset(data):
            return None, "Gemini returned an incomplete question. Please try again later."
        return data, None
    except Exception as exc:
        return None, f"Could not generate today's AI question right now: {exc}"


def normalize_output(value):
    return "\n".join(line.rstrip() for line in (value or "").strip().splitlines()).strip()


def parse_example_bindings(example_input):
    bindings = {}
    for line in (example_input or "").strip().splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip()
        if not name:
            continue
        bindings[name] = ast.literal_eval(value)
    return bindings


def extract_function_info(signature):
    match = re.match(r"def\s+(\w+)\s*\((.*?)\)\s*:", (signature or "").strip())
    if not match:
        return None, []
    params = [
        part.strip().split("=")[0].strip()
        for part in match.group(2).split(",")
        if part.strip()
    ]
    return match.group(1), params


def wrap_python_solution(source_code, example_input, function_signature):
    func_name, param_names = extract_function_info(function_signature)
    if not func_name or not param_names:
        return source_code, None

    bindings = parse_example_bindings(example_input)
    missing = [name for name in param_names if name not in bindings]
    if missing:
        return source_code, f"Could not parse example input for: {', '.join(missing)}"

    setup = "\n".join(f"{name} = {repr(value)}" for name, value in bindings.items())
    args = ", ".join(param_names)
    wrapped = (
        f"{source_code.rstrip()}\n\n"
        f"{setup}\n"
        f"_result = {func_name}({args})\n"
        f"print(_result)\n"
    )
    return wrapped, None


def outputs_match(actual, expected):
    actual_norm = normalize_output(actual)
    expected_norm = normalize_output(expected)
    if actual_norm.lower() in {"true", "false"} and expected_norm.lower() in {"true", "false"}:
        return actual_norm.lower() == expected_norm.lower()

    try:
        expected_value = ast.literal_eval(expected_norm)
        expected_is_literal = True
    except (ValueError, SyntaxError):
        expected_value = None
        expected_is_literal = False

    try:
        actual_value = ast.literal_eval(actual_norm)
        actual_is_literal = True
    except (ValueError, SyntaxError):
        actual_value = None
        actual_is_literal = False

    if expected_is_literal and isinstance(expected_value, str):
        return actual_value == expected_value if actual_is_literal else actual_norm == expected_value
    if expected_is_literal and actual_is_literal:
        return actual_value == expected_value
    return actual_norm == expected_norm


def prepare_source(language, source_code, example_input, function_signature):
    language = language.lower()
    if language != "python" or not function_signature:
        return source_code, None
    return wrap_python_solution(source_code, example_input, function_signature)


def run_code(language, source_code, stdin_text, expected_output=None, function_signature=None):
    start = time.perf_counter()
    language = language.lower()
    prepared, prep_error = prepare_source(language, source_code, stdin_text, function_signature)
    if prep_error:
        return {
            "output": "",
            "errors": prep_error,
            "execution_time": 0,
            "verdict": "Error",
        }

    try:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            if language == "python":
                code_file = temp_path / "main.py"
                code_file.write_text(prepared, encoding="utf-8")
                command = [sys.executable, str(code_file)]
            elif language == "c":
                if function_signature:
                    return {
                        "output": "",
                        "errors": "Function-based problems are currently supported in Python only.",
                        "execution_time": 0,
                        "verdict": "Error",
                    }
                code_file = temp_path / "main.c"
                exe_file = temp_path / "main.exe"
                code_file.write_text(source_code, encoding="utf-8")
                compile_proc = subprocess.run(
                    ["gcc", str(code_file), "-O2", "-o", str(exe_file)],
                    capture_output=True,
                    text=True,
                    timeout=8,
                )
                if compile_proc.returncode:
                    return {"output": "", "errors": compile_proc.stderr, "execution_time": 0, "verdict": "Compile Error"}
                command = [str(exe_file)]
            elif language == "cpp":
                if function_signature:
                    return {
                        "output": "",
                        "errors": "Function-based problems are currently supported in Python only.",
                        "execution_time": 0,
                        "verdict": "Error",
                    }
                code_file = temp_path / "main.cpp"
                exe_file = temp_path / "main.exe"
                code_file.write_text(source_code, encoding="utf-8")
                compile_proc = subprocess.run(
                    ["g++", str(code_file), "-O2", "-std=c++17", "-o", str(exe_file)],
                    capture_output=True,
                    text=True,
                    timeout=8,
                )
                if compile_proc.returncode:
                    return {"output": "", "errors": compile_proc.stderr, "execution_time": 0, "verdict": "Compile Error"}
                command = [str(exe_file)]
            elif language == "java":
                if function_signature:
                    return {
                        "output": "",
                        "errors": "Function-based problems are currently supported in Python only.",
                        "execution_time": 0,
                        "verdict": "Error",
                    }
                code_file = temp_path / "Main.java"
                code_file.write_text(source_code, encoding="utf-8")
                compile_proc = subprocess.run(
                    ["javac", str(code_file)],
                    cwd=temp,
                    capture_output=True,
                    text=True,
                    timeout=8,
                )
                if compile_proc.returncode:
                    return {"output": "", "errors": compile_proc.stderr, "execution_time": 0, "verdict": "Compile Error"}
                command = ["java", "-cp", temp, "Main"]
            else:
                return {"output": "", "errors": "Unsupported language.", "execution_time": 0, "verdict": "Error"}

            proc = subprocess.run(
                command,
                input=stdin_text if not function_signature or language != "python" else None,
                capture_output=True,
                text=True,
                timeout=5,
            )
            elapsed = round(time.perf_counter() - start, 4)
            verdict = "Runtime Error" if proc.returncode else "Accepted"
            if expected_output is not None and proc.returncode == 0:
                verdict = "Accepted" if outputs_match(proc.stdout, expected_output) else "Wrong Answer"
            return {
                "output": proc.stdout,
                "errors": proc.stderr,
                "execution_time": elapsed,
                "verdict": verdict,
            }
    except subprocess.TimeoutExpired:
        return {"output": "", "errors": "Execution timed out.", "execution_time": 5, "verdict": "Time Limit Exceeded"}
    except FileNotFoundError as exc:
        return {
            "output": "",
            "errors": f"Compiler or runtime is not installed: {exc.filename}",
            "execution_time": 0,
            "verdict": "Environment Error",
        }


@app.context_processor
def inject_user():
    if not session.get("user_id"):
        return {"current_user": None, "current_stats": None}
    user = get_user(session["user_id"])
    return {"current_user": user, "current_stats": user_stats(session["user_id"])}


def complete_oauth_login(email, fullname):
    email = email.strip().lower()
    fullname = fullname.strip() if isinstance(fullname, str) else ""
    fullname = fullname or email.split("@", 1)[0]
    with get_db() as conn:
        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if user is None:
            conn.execute(
                "INSERT INTO users (fullname, email, password) VALUES (?, ?, ?)",
                (fullname, email, generate_password_hash(secrets.token_urlsafe(32))),
            )
            user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()

    session.clear()
    session["user_id"] = user["id"]
    return redirect(url_for("dashboard"))


@app.route("/")
def home():
    return redirect(url_for("dashboard") if session.get("user_id") else url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    message = ""
    if request.method == "POST":
        fullname = request.form.get("fullname", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if len(password) < 6:
            message = "Password must be at least 6 characters."
        else:
            try:
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO users (fullname, email, password) VALUES (?, ?, ?)",
                        (fullname, email, generate_password_hash(password)),
                    )
                with get_db() as conn:
                    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
                    if user and check_password_hash(user["password"], password):
                        session.clear()
                        session["user_id"] = user["id"]
                        return redirect(url_for("dashboard"))
            except Exception:
                message = "That email is already registered."
    return render_template("register.html", message=message)


@app.route("/login", methods=["GET", "POST"])
def login():
    message = "Registration successful. Please log in." if request.args.get("registered") else ""
    oauth_errors = {
        "google": "Google sign-in could not be completed. Please try again.",
        "google_email": "Google did not provide a verified email address.",
        "google_unavailable": "Google sign-in is not configured for this application.",
        "github": "GitHub sign-in could not be completed. Please try again.",
        "github_email": "GitHub did not provide a verified email address.",
    }
    if request.args.get("oauth_error") in oauth_errors:
        message = oauth_errors[request.args["oauth_error"]]
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        with get_db() as conn:
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user and check_password_hash(user["password"], password):
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("dashboard"))
        message = "Invalid email or password."
    return render_template(
        "login.html",
        message=message,
        google_oauth_enabled=GOOGLE_OAUTH_ENABLED,
        github_oauth_enabled=GITHUB_OAUTH_ENABLED,
    )


@app.route("/login/google")
def google_login():
    if not GOOGLE_OAUTH_ENABLED:
        return redirect(url_for("login", oauth_error="google_unavailable"))
    redirect_uri = url_for("google_callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri, prompt="select_account")


@app.route("/login/google/callback")
def google_callback():
    if not GOOGLE_OAUTH_ENABLED:
        return redirect(url_for("login"))
    try:
        oauth.google.authorize_access_token()
    except OAuthError:
        return redirect(url_for("login", oauth_error="google"))

    user_info_response = oauth.google.get("userinfo")
    user_info_response.raise_for_status()
    user_info = user_info_response.json()
    email = user_info.get("email")
    if not isinstance(email, str) or not email or user_info.get("email_verified") is not True:
        return redirect(url_for("login", oauth_error="google_email"))
    return complete_oauth_login(email, user_info.get("name", ""))


@app.route("/login/github")
def github_login():
    if not GITHUB_OAUTH_ENABLED:
        return redirect(url_for("login"))
    redirect_uri = url_for("github_callback", _external=True)
    return oauth.github.authorize_redirect(redirect_uri)


@app.route("/login/github/callback")
def github_callback():
    if not GITHUB_OAUTH_ENABLED:
        return redirect(url_for("login"))
    try:
        oauth.github.authorize_access_token()
    except OAuthError:
        return redirect(url_for("login", oauth_error="github"))

    profile_response = oauth.github.get("user")
    profile_response.raise_for_status()
    profile = profile_response.json()
    email_response = oauth.github.get("user/emails")
    email_response.raise_for_status()
    emails = email_response.json()
    verified_emails = [
        item["email"]
        for item in emails
        if item.get("verified") and item.get("email")
    ]
    primary_email = next(
        (
            item["email"]
            for item in emails
            if item.get("primary") and item.get("verified") and item.get("email")
        ),
        verified_emails[0] if verified_emails else None,
    )
    if not primary_email:
        return redirect(url_for("login", oauth_error="github_email"))
    return complete_oauth_login(primary_email, profile.get("name") or profile.get("login", ""))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    stats = user_stats(session["user_id"])
    return render_template("dashboard.html", stats=stats)


@app.route("/daily-question")
@login_required
def daily_question():
    question, error = get_or_create_daily_question(get_question_from_ai)
    return render_template(
        "daily_question.html",
        question=question,
        error=error,
        page_label="Today's Question",
        stats=user_stats(session["user_id"]),
        is_daily=True,
    )


@app.route("/problems/<int:question_id>")
@login_required
def practice_question(question_id):
    question = get_question(question_id)
    if not question:
        return redirect(url_for("problems"))
    return render_template(
        "daily_question.html",
        question=question,
        error=None,
        page_label="Practice Problem",
        stats=user_stats(session["user_id"]),
        is_daily=False,
    )


@app.route("/problems")
@login_required
def problems():
    library = get_all_questions()
    archive = get_daily_question_archive()
    stats = user_stats(session["user_id"])
    solved_ids = set()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT question_id FROM submissions WHERE user_id = ? AND verdict = 'Accepted'",
            (session["user_id"],),
        ).fetchall()
        solved_ids = {row["question_id"] for row in rows}
    return render_template(
        "problems.html",
        library=library,
        questions=archive,
        solved_ids=solved_ids,
        stats=stats,
    )


@app.route("/profile")
@login_required
def profile():
    user = get_user(session["user_id"])
    stats = user_stats(session["user_id"])
    return render_template("profile.html", user=user, stats=stats)


@app.route("/api/run", methods=["POST"])
@login_required
def api_run():
    payload = request.get_json(force=True)
    question = get_question(payload.get("question_id"))
    if not question:
        return jsonify({"verdict": "Error", "errors": "Question not found.", "output": "", "execution_time": 0}), 404
    result = run_code(
        payload.get("language", "python"),
        payload.get("source_code", ""),
        question["example_input"],
        function_signature=question.get("function_signature"),
    )
    return jsonify(result)


@app.route("/api/submit", methods=["POST"])
@login_required
def api_submit():
    payload = request.get_json(force=True)
    question = get_question(payload.get("question_id"))
    if not question:
        return jsonify({"verdict": "Error", "errors": "Question not found.", "output": "", "execution_time": 0}), 404

    test_input = question.get("hidden_input") or question["example_input"]
    expected = question.get("hidden_output") or question["example_output"]
    result = run_code(
        payload.get("language", "python"),
        payload.get("source_code", ""),
        test_input,
        expected,
        function_signature=question.get("function_signature"),
    )
    record_submission(
        session["user_id"],
        question["id"],
        payload.get("language", "python"),
        payload.get("source_code", ""),
        result["verdict"],
        result["execution_time"],
    )
    stats = user_stats(session["user_id"])
    result["stats"] = {
        "current_streak": stats["current_streak"],
        "longest_streak": stats["longest_streak"],
        "today_solved": stats["today_solved"],
        "questions_solved": stats["questions_solved"],
        "accuracy": stats["accuracy"],
    }
    return jsonify(result)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG") == "1",
    )
