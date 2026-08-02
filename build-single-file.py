# גרסת עבודה — קובץ HTML יחיד, בסיס נתונים אמיתי, בלי הדגמה.
# ה-CSP נשמר: במקום להסירו בגלל הסקריפט המוטבע, מחשבים sha256 של
# תוכן הסקריפט ומרשים בדיוק אותו. ההקשחה נשארת מלאה.

import re, os, io, base64, hashlib

SRC = r"C:\Users\avrah\OneDrive\שולחן העבודה\קלוד קוד- התחלה\kesef"
OUT = r"C:\Users\avrah\OneDrive\שולחן העבודה\קלוד קוד- התחלה\כסף.html"

def read(n):
    with io.open(os.path.join(SRC, n), encoding="utf-8") as f:
        return f.read()

def strip_imports(code):
    out, i, lines = [], 0, code.split("\n")
    while i < len(lines):
        if re.match(r"^\s*import\s", lines[i]):
            buf = lines[i]
            while "from" not in buf and i + 1 < len(lines):
                i += 1
                buf += "\n" + lines[i]
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)

EXPORT_DECL = re.compile(r"^export\s+(?:async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)", re.M)

def to_iife(name, code):
    code = strip_imports(code)
    names = sorted(set(EXPORT_DECL.findall(code)))
    code = re.sub(r"^export\s+", "", code, flags=re.M)
    return f"/* ===== {name} ===== */\nconst {name} = (() => {{\n{code}\nreturn {{ {', '.join(names)} }};\n}})();\n"

def flat(code):
    return re.sub(r"^export\s+", "", strip_imports(code), flags=re.M)

tax    = flat(read("taxonomy.js"))
crypto = to_iife("Crypto", read("crypto.js"))
db     = to_iife("DB", read("db.js"))
ch     = to_iife("C", read("charts.js"))
st     = to_iife("ST", read("stats.js"))
ins    = to_iife("IN", read("insights.js")).replace(
         "const IN = (() => {", "const IN = (() => {\nconst { normMerchant } = DB;", 1)
ai     = to_iife("AI", read("ai.js"))
app    = flat(read("app.js"))

# בקובץ יחיד אין service worker נפרד — מונעים ניסיון רישום שייכשל
app = app.replace(
    "if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});",
    "/* קובץ יחיד — אין service worker */")

# ה-hash מחושב על התוכן **המדויק** שיישב בין תגי הסקריפט, כולל כל תו רווח.
# שורה ריקה אחת הפרש = hash אחר = הדפדפן חוסם את הסקריפט של האפליקציה עצמה.
script_body = "\n" + "\n".join([tax, crypto, db, ch, st, ins, ai, app]) + "\n"
digest = base64.b64encode(hashlib.sha256(script_body.encode("utf-8")).digest()).decode()
CSP = (
    "default-src 'none'; "
    f"script-src 'sha256-{digest}'; "
    "style-src 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "connect-src https://generativelanguage.googleapis.com; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)

html = read("index.html")
css = read("style.css")

html = re.sub(r'<meta http-equiv="Content-Security-Policy".*?>',
              f'<meta http-equiv="Content-Security-Policy" content="{CSP}">', html, flags=re.S)
html = html.replace('<link rel="stylesheet" href="./style.css">', f"<style>\n{css}\n</style>")
html = html.replace('<link rel="manifest" href="./manifest.webmanifest">', "")
html = html.replace('<link rel="apple-touch-icon" href="./icons/icon-192.png">', "")
html = html.replace('<script type="module" src="./app.js"></script>',
                    '<script type="module">' + script_body + '</script>')

with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("wrote", OUT, os.path.getsize(OUT), "bytes")
print("csp sha256:", digest[:16], "...")
