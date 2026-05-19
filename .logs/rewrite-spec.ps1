$path = 'e:\money\LeadHunt-Codex\apps\api\src\leads\lead-qualification.service.spec.ts'
$content = Get-Content -Raw $path
$content = $content -replace '"intelligence_review"', '"intelligence"'
$content = $content -replace '"evidence_review"', '"rejected"'
$content = $content -replace '"country_conflict_review"', '"review"'
$content = $content -replace '"needs_country_review"', '"review"'
Set-Content -NoNewline -Path $path -Value $content
