# echo1.ps1 -- test fixture: writes its first argument back verbatim, proving the arg is passed as literal DATA
# (powershell -File $args, no shell parsing). Used by command-fence.test.js to prove injection is structurally inert.
param([Parameter(Position = 0)] [string]$a = "")
Write-Output $a
