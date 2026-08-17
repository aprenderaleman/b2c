# Convert B1 and B2 docx to PDF via Word COM.
# Run via:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\convert_b_pdfs.ps1
$ErrorActionPreference = "Stop"
$root = "C:\Users\gelfi\Desktop\b2c\materiales-marketing"

# Pre-clean any stale Word instance / lock files
Get-Process WINWORD -ErrorAction SilentlyContinue | Stop-Process -Force
Get-ChildItem "$root\~`$*.docx" -ErrorAction SilentlyContinue | Remove-Item -Force
Start-Sleep -Seconds 2

Write-Output "Starting Word..."
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

$pairs = @(
  @{ src = "B1-guia-6-da-tu-opinin-el-subjuntivo-ii-konjunktiv-ii"; },
  @{ src = "B2-guia-7-argumenta-y-convence-pasiva--conectores-complejos"; }
)
foreach ($p in $pairs) {
  $srcPath = "$root\$($p.src).docx"
  $dstPath = "$root\$($p.src).pdf"
  Write-Output "  -> $($p.src)"
  $doc = $word.Documents.Open($srcPath, $false, $true)
  $doc.SaveAs([ref]$dstPath, [ref]17)
  $doc.Close($false)
  Write-Output "     done"
}

$word.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
[GC]::Collect()
[GC]::WaitForPendingFinalizers()

Get-ChildItem "$root\B*.pdf" | Format-Table Name, @{n='KB';e={[math]::Round($_.Length/1024,1)}} -AutoSize
