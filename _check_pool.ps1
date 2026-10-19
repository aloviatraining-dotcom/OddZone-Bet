$path = "games\standalone\8-ball-pool.html"
$html = Get-Content $path -Raw

# Extract inline <script> blocks (those with no src attribute)
$pattern = '(?s)<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>'
$matches = [regex]::Matches($html, $pattern)
Write-Output "inline script blocks: $($matches.Count)"

$i = 0
foreach ($m in $matches) {
  $i++
  $code = $m.Groups[1].Value
  $tmp = Join-Path $env:TEMP "pool_script_$i.js"
  [System.IO.File]::WriteAllText($tmp, $code)
  node --check $tmp 2>&1 | ForEach-Object { Write-Output "  [block $i] $_" }
  if ($LASTEXITCODE -eq 0) { Write-Output "  [block $i] OK ($($code.Length) chars)" }
}

Write-Output "`n--- element id check ---"
foreach ($id in @('nm0', 'nm1', 'av0', 'av1', 'trayL', 'trayR', 'hudScore', 'hudPocketed', 'stage', 'app', 'cuePanel', 'spinDot', 'asyncBadge')) {
  $found = $html -match ('id="' + $id + '"')
  Write-Output ("{0,-12} {1}" -f $id, $(if ($found) { "present" } else { "MISSING" }))
}