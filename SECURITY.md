# Security policy

## Supported versions

Security fixes are made on the latest commit of the default branch. This is a personal practice project and does not have separately supported release lines.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. If that feature is unavailable, open an issue asking the maintainer for a private contact method, but do not include vulnerability details or secrets in the issue.

Do not test a report with real bank data, real Plaid credentials or another person's accounts. Use Plaid Sandbox and synthetic data only.

## Deployment scope

This application is unauthenticated and is designed to bind only to the local machine. Public or shared-network deployment is unsupported. Authentication, authorization and per-user data isolation must be added before deploying it.

For the application's security model, data handling rules and known scope limits, see [docs/security.md](docs/security.md).
