# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's [private vulnerability reporting](https://github.com/YellowUmbrellaDev/cumplista/security/advisories/new) for this repository.

Include what you found, how to reproduce it, and what you think the impact is. We will acknowledge the report, work on a fix and credit you if you want, once a fix is released.

## Scope

Cumplista is a small application that holds names, emails and gift lists, and password and PIN hashes. These are in scope:

- Anything that lets the owner of a list see guests, claims or side gifts through the application. That separation is the core promise of the product.
- Authentication and session problems, for example reading or forging another person's session, or bypassing the rate limits.
- Cross-site scripting, request forgery, open redirects and injection.
- Secrets or personal data exposed through the application or the repository.

Known limits are documented and are not vulnerabilities. For example, an owner can register as a guest, and a guest has no PIN recovery. See [Integrations](docs/integrations.md#privacy-and-trust).

## Supported versions

Only the latest commit on `main` is supported.
