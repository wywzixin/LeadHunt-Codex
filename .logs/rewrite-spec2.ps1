$path = 'e:\money\LeadHunt-Codex\apps\api\src\leads\lead-qualification.service.spec.ts'
$content = Get-Content -Raw $path
$content = $content -replace '\(\(\[input\]: any\) =>', '(([input]: any) =>'
# Use a simpler escape: replace the exact malformed double-paren prefix.
$content = $content -replace '      \(\(\[input\]: any\) =>', '      ([input]: any) =>'
Set-Content -NoNewline -Path $path -Value $content
