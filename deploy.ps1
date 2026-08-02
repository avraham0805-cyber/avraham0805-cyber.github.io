# פריסה מלאה של "כסף" ל-GitHub Pages.
# רץ מעצמו ברגע שההרשאה ל-GitHub הושלמה. אין בו שום דבר אינטראקטיבי.

$ErrorActionPreference = 'Stop'
$repo = 'kesef'
$dir  = "C:\Users\avrah\OneDrive\שולחן העבודה\קלוד קוד- התחלה\kesef"
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")

function Step($m) { Write-Output "==> $m" }

Step "בודק הרשאה"
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output "לא מחובר ל-GitHub. הרץ: gh auth login --web"; exit 1 }

$user = (gh api user --jq '.login')
Step "מחובר כ-$user"

# --- יצירת הריפו אם אינו קיים ---
$exists = $false
try { gh repo view "$user/$repo" 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $exists = $true } } catch { }

if (-not $exists) {
  Step "יוצר ריפו ציבורי $repo"
  gh repo create $repo --public --description "מעקב הוצאות אישי — PWA ללא שרת, הנתונים נשארים על המכשיר" --disable-wiki
} else {
  Step "הריפו כבר קיים"
}

# --- חיבור remote ודחיפה ---
$remote = git -C $dir remote 2>$null
if (-not $remote) {
  Step "מחבר remote"
  git -C $dir remote add origin "https://github.com/$user/$repo.git"
} else {
  git -C $dir remote set-url origin "https://github.com/$user/$repo.git"
}

Step "דוחף"
git -C $dir push -u origin main --force-with-lease
if ($LASTEXITCODE -ne 0) { Write-Output "הדחיפה נכשלה"; exit 1 }

# --- הפעלת GitHub Pages מענף main ---
Step "מפעיל GitHub Pages"
$tmp = Join-Path $env:TEMP 'kesef-pages.json'
'{"source":{"branch":"main","path":"/"}}' | Out-File -FilePath $tmp -Encoding ascii -NoNewline
gh api -X POST "repos/$user/$repo/pages" -H "Accept: application/vnd.github+json" --input $tmp 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  # כבר מופעל — מעדכנים במקום ליצור
  gh api -X PUT "repos/$user/$repo/pages" -H "Accept: application/vnd.github+json" --input $tmp 2>&1 | Out-Null
}
Remove-Item $tmp -ErrorAction SilentlyContinue

$url = "https://$user.github.io/$repo/"
Step "ממתין לבנייה הראשונה"
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 6
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { Step "חי"; break }
  } catch { }
}

Write-Output ""
Write-Output "======================================"
Write-Output "  $url"
Write-Output "======================================"
Write-Output ""
Write-Output "בטלפון: פתח בכרום -> תפריט -> הוספה למסך הבית"
Set-Clipboard -Value $url
Write-Output "(הכתובת הועתקה ללוח)"
