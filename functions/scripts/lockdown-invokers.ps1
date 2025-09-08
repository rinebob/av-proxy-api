<#
.SYNOPSIS
  Lock down Cloud Run HTTPS function invokers (roles/run.invoker) across services.

.DESCRIPTION
  Removes public access (allUsers) from specified Cloud Run services and grants
  the Cloud Run Invoker role (roles/run.invoker) to a specified service account.
  Prints the resulting invoker bindings for verification.

.PARAMETER ProjectId
  GCP project ID that hosts the Cloud Run services (e.g., alpha-vantage-proxy-api).

.PARAMETER Region
  Cloud Run region (e.g., us-central1).

.PARAMETER InvokerServiceAccount
  The service account email to grant roles/run.invoker to (e.g., maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com).

.PARAMETER Services
  Optional array of Cloud Run service names to target. Defaults to a set of internal HTTPS services:
  - alphavantageapiv2
  - benzingaapiv2
  - listsymbolsv2
  - listcollections
  - requestbenzinganews

.EXAMPLE
  pwsh -File functions/scripts/lockdown-invokers.ps1 `
    -ProjectId alpha-vantage-proxy-api `
    -Region us-central1 `
    -InvokerServiceAccount maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com

.EXAMPLE
  # Custom set of services
  pwsh -File functions/scripts/lockdown-invokers.ps1 `
    -ProjectId alpha-vantage-proxy-api `
    -Region us-central1 `
    -InvokerServiceAccount maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com `
    -Services 'alphavantageapiv2','benzingaapiv2'

.NOTES
  - Requires gcloud CLI, authenticated with permissions to update Cloud Run IAM.
  - Use after creating new HTTPS functions or cloning to a new environment.
  - Pair with application-level auth in your gateways (Firebase ID token or Google OIDC) for defense-in-depth.
#>

param(
  [Parameter(Mandatory=$true)][string]$ProjectId,
  [Parameter(Mandatory=$true)][string]$Region,
  [Parameter(Mandatory=$true)][string]$InvokerServiceAccount,
  [string[]]$Services = @(
    'alphavantageapiv2',
    'benzingaapiv2',
    'listsymbolsv2',
    'listcollections',
    'requestbenzinganews'
  )
)

Write-Host "Project: $ProjectId" -ForegroundColor Cyan
Write-Host "Region : $Region" -ForegroundColor Cyan
Write-Host "Invoker SA: $InvokerServiceAccount" -ForegroundColor Cyan
Write-Host "Services: $($Services -join ', ')" -ForegroundColor Cyan

function Remove-PublicInvoker {
  param([string]$Service)
  Write-Host "Removing public invoker (allUsers) from $Service ..." -ForegroundColor Yellow
  gcloud run services remove-iam-policy-binding $Service `
    --region=$Region `
    --project=$ProjectId `
    --member="allUsers" `
    --role="roles/run.invoker"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Note: remove-iam-policy-binding may fail if no public binding exists (ok)." -ForegroundColor DarkYellow
  }
}

function Add-InvokerBinding {
  param([string]$Service)
  Write-Host "Granting roles/run.invoker on $Service to $InvokerServiceAccount ..." -ForegroundColor Yellow
  gcloud run services add-iam-policy-binding $Service `
    --region=$Region `
    --project=$ProjectId `
    --member="serviceAccount:$InvokerServiceAccount" `
    --role="roles/run.invoker"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to add invoker binding for $Service"
  }
}

function Show-InvokerBindings {
  param([string]$Service)
  $members = gcloud run services get-iam-policy $Service `
    --region=$Region `
    --project=$ProjectId `
    --format="value(bindings[role=roles/run.invoker].members)"
  Write-Host "Invoker members for $Service:" -ForegroundColor Green
  if ([string]::IsNullOrWhiteSpace($members)) {
    Write-Host "  (none)" -ForegroundColor DarkGray
  } else {
    $members -split ';' | ForEach-Object { Write-Host "  $_" }
  }
}

# Execute
foreach ($svc in $Services) {
  Remove-PublicInvoker -Service $svc
  Add-InvokerBinding -Service $svc
  Show-InvokerBindings -Service $svc
}

Write-Host "Done." -ForegroundColor Cyan
