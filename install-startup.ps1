param([Parameter(Mandatory=$true)][string]$SillyTavernPath, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$htmlPath = Join-Path $SillyTavernPath 'public\index.html'
if (-not (Test-Path -LiteralPath $htmlPath)) { throw 'SillyTavern public/index.html was not found.' }
$html = [System.IO.File]::ReadAllText($htmlPath)
$pattern = '(?s)\s*<!-- Claude Surface startup -->.*?<!-- /Claude Surface startup -->'
$html = [regex]::Replace($html, $pattern, '')
if (-not $Remove) {
    $tag = "`n    <!-- Claude Surface startup -->`n    <script src=`"/scripts/extensions/third-party/claude-surface/boot.js`"></script>`n    <!-- /Claude Surface startup -->`n"
    $html = $html.Replace('</head>', "$tag</head>")
}
[System.IO.File]::WriteAllText($htmlPath, $html, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Claude Surface startup integration updated. Re-run after a SillyTavern update if needed.'
