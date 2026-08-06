# פריסה קבועה ל-GitHub Pages.
#
# למה ריפו בשם <user>.github.io ולא סתם "kesef":
# לריפו כזה גיטהאב מפעיל Pages **אוטומטית**, בלי להיכנס להגדרות.
# זה חוסך שלב ידני שלם, והכתובת יוצאת נקייה בשורש הדומיין.
#
# gh auth נחסם ברשת הזו (POST ל-oauth/access_token נתקע), ולכן כאן
# משתמשים ב-git נקי עם Git Credential Manager — חלון התחברות רגיל.

param(
  [string]$User = "avraham0805-cyber"
)

$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = "$User.github.io"
$url  = "https://$User.github.io/"
Set-Location $dir

function Say($t, $c = "Gray") { Write-Host "  $t" -ForegroundColor $c }

Write-Host ""
Say "פריסת «כסף» ל-GitHub Pages" "Cyan"
Say ("-" * 34) "DarkGray"

# --- 1. האם הריפו קיים ---
Say "בודק אם הריפו קיים..." "DarkGray"
$exists = $false
try {
  $r = Invoke-WebRequest "https://api.github.com/repos/$User/$repo" -UseBasicParsing -TimeoutSec 15
  $exists = ($r.StatusCode -eq 200)
} catch { $exists = $false }

if (-not $exists) {
  Write-Host ""
  Say "הריפו עדיין לא קיים. זה השלב היחיד שאני לא יכול לעשות בשבילך." "Yellow"
  Write-Host ""
  Say "נפתח לך בדפדפן עמוד יצירה ממולא מראש." "Yellow"
  Say "רק לחץ Create repository — אל תסמן שום דבר תחת Initialize." "Yellow"
  Write-Host ""
  Start-Process "https://github.com/new?name=$repo&visibility=public"
  Read-Host "  אחרי שיצרת, הקש Enter כדי להמשיך"

  try {
    $r = Invoke-WebRequest "https://api.github.com/repos/$User/$repo" -UseBasicParsing -TimeoutSec 15
    $exists = ($r.StatusCode -eq 200)
  } catch { $exists = $false }

  if (-not $exists) {
    Say "עדיין לא מוצא את הריפו. ודא שהשם בדיוק: $repo" "Red"
    exit 1
  }
}
Say "✓ הריפו קיים" "Green"

# --- 2. חיווט הרימוט ---
if (-not (git config --global credential.helper)) { git config --global credential.helper manager }
if (git remote 2>$null | Select-String -Quiet "^origin$") { git remote set-url origin "https://github.com/$User/$repo.git" }
else { git remote add origin "https://github.com/$User/$repo.git" }
Say "✓ רימוט: $User/$repo" "Green"

# --- 3. דחיפה ---
Write-Host ""
Say "דוחף... אם ייפתח חלון התחברות של GitHub — אשר אותו." "Yellow"
Write-Host ""
git push -u origin main --force
if ($LASTEXITCODE -ne 0) { Say "הדחיפה נכשלה." "Red"; exit 1 }
Say "✓ נדחף" "Green"

# --- 4. המתנה ל-Pages ---
Write-Host ""
Say "Pages מופעל אוטומטית לריפו הזה. ממתין לעלייה..." "DarkGray"
$live = $false
foreach ($i in 1..40) {
  Start-Sleep -Seconds 15
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 12
    if ($r.StatusCode -eq 200 -and $r.Content -match "כסף") { $live = $true; break }
  } catch { }
  Say "  ...עדיין נבנה ($($i*15) שניות)" "DarkGray"
}

Write-Host ""
if ($live) {
  Say "================================" "Green"
  Say "  האפליקציה חיה:" "Green"
  Say "  $url" "Cyan"
  Say "================================" "Green"
  Write-Host ""
  Say "בטלפון: פתח בכרום ← תפריט ⋮ ← הוספה למסך הבית" "Yellow"
  Start-Process $url
} else {
  Say "הדחיפה הצליחה אבל האתר עוד לא עלה." "Yellow"
  Say "בנייה ראשונה לוקחת לפעמים כמה דקות. נסה בעוד קצת:" "Yellow"
  Say "  $url" "Cyan"
}
Write-Host ""
