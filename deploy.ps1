# פריסה לגיטהאב — עוקף את gh auth שנחסם ברשת הזו.
#
# gh נכשל שוב ושוב על POST ל-github.com/login/oauth/access_token, בעוד
# git ו-curl מול אותו מארח עובדים מצוין. לכן המסלול כאן הוא git נקי
# עם Git Credential Manager, שפותח חלון התחברות רגיל בדפדפן.
#
# הרצה:  powershell -ExecutionPolicy Bypass -File deploy.ps1 -User <שם-המשתמש-שלך>

param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Repo = "kesef"
)

$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

Write-Host ""
Write-Host "  פריסת 'כסף' ל-GitHub Pages" -ForegroundColor Cyan
Write-Host "  ---------------------------" -ForegroundColor DarkGray

# GCM חייב להיות פעיל, אחרת git ינסה לשאול בטרמינל ויתקע
if (-not (git config --global credential.helper)) {
  git config --global credential.helper manager
  Write-Host "  · הופעל Git Credential Manager" -ForegroundColor DarkGray
}

$remote = "https://github.com/$User/$Repo.git"

if (git remote 2>$null | Select-String -Quiet "^origin$") {
  git remote set-url origin $remote
} else {
  git remote add origin $remote
}
Write-Host "  · יעד: $remote" -ForegroundColor DarkGray

Write-Host ""
Write-Host "  דוחף... ייפתח חלון התחברות של GitHub — אשר אותו." -ForegroundColor Yellow
Write-Host ""

git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  הדחיפה נכשלה." -ForegroundColor Red
  Write-Host "  אם השגיאה היא 'Repository not found' — הריפו עדיין לא נוצר." -ForegroundColor Red
  Write-Host "  צור אותו כאן ואז הרץ שוב:" -ForegroundColor Red
  Write-Host "  https://github.com/new?name=$Repo" -ForegroundColor Cyan
  exit 1
}

Write-Host ""
Write-Host "  ✓ נדחף בהצלחה" -ForegroundColor Green
Write-Host ""
Write-Host "  נותר שלב אחד ידני — הפעלת Pages:" -ForegroundColor Yellow
Write-Host "  https://github.com/$User/$Repo/settings/pages" -ForegroundColor Cyan
Write-Host "  תחת Branch בחר: main / (root)  ואז Save" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  תוך דקה-שתיים האפליקציה תהיה חיה בכתובת:" -ForegroundColor Green
Write-Host "  https://$User.github.io/$Repo/" -ForegroundColor Cyan
Write-Host ""
Write-Host "  פתח אותה בכרום בטלפון, ואז: תפריט ⋮ ← הוספה למסך הבית" -ForegroundColor DarkGray
Write-Host ""
