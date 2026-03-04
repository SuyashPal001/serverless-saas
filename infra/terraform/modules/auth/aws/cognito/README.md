# auth/aws/cognito

Creates a Cognito User Pool with custom JWT claims, app clients, and Pre Token Generation Lambda wiring.

## What it creates
- Cognito User Pool (email as identifier, custom schema for tenantId/role/plan)
- Cognito User Pool Domain (hosted UI)
- One app client per entry in `var.app_clients`
- Lambda invoke permission for Pre Token Generation trigger
- MFA configuration (OPTIONAL by default)

## What it does NOT do
- Does not create the Pre Token Generation Lambda — pass its ARN via `pre_token_generation_lambda_arn`
- Does not create SES identities — pass SES source ARN via `email_configuration`
- Does not write to SSM — outputs consumed by composition layer

## Design decisions

**Custom schema attributes** — `custom:tenantId`, `custom:role`, `custom:plan` are baked
into the user pool schema. The Pre Token Generation Lambda reads these from the user record
and stamps them into the JWT access token. API Gateway verifies the JWT, extracts claims,
and passes them to Hono middleware — no database lookup needed per request (ADR-008).

**`lambda_version = "V2_0"`** — V2 trigger receives richer context including the full
token claims, enabling the Lambda to modify both access and id tokens. V1 only supports
id token modification.

**`prevent_user_existence_errors = "ENABLED"`** — prevents user enumeration attacks.
Auth errors are always generic regardless of whether the email exists.

**`enable_token_revocation = true`** — allows individual refresh tokens to be revoked
(logout, session invalidation). Works with the sessions table jti blacklist (ADR-008).

**`deletion_protection = true` by default** — prevents accidental pool deletion in
production. Override to false for dev/ephemeral environments.

**`advanced_security_mode = "AUDIT"` by default** — logs anomalous signin attempts
without blocking them. Switch to `ENFORCED` for production to enable adaptive auth.

## Bootstrap note — chicken and egg
The Pre Token Generation Lambda ARN must exist before this module runs.
On first bootstrap, deploy SAM (foundation Lambdas) before running this Terraform module,
or use a placeholder Lambda ARN and update after SAM deploys.

Deployment order:
```
1. terraform apply (all modules except cognito)
2. sam deploy foundation   → creates pre-token Lambda
3. terraform apply         → cognito module picks up Lambda ARN from SSM
```

## Usage

```hcl
module "cognito" {
  source = "../../modules/auth/aws/cognito"

  user_pool_name = "platform-dev"
  domain_prefix  = "platform-dev-auth"   # must be globally unique

  pre_token_generation_lambda_arn = data.aws_ssm_parameter.pretoken_lambda_arn.value

  password_policy = {
    minimum_length = 12
    require_symbols = true
  }

  mfa_configuration      = "OPTIONAL"
  advanced_security_mode = "AUDIT"
  deletion_protection    = false   # dev only

  email_configuration = {
    email_sending_account = "COGNITO_DEFAULT"  # dev — switch to DEVELOPER + SES in prod
  }

  app_clients = {
    web = {
      name                        = "platform-dev-web"
      access_token_validity_hours = 1
      refresh_token_validity_days = 30
      callback_urls               = ["http://localhost:3000/auth/callback"]
      logout_urls                 = ["http://localhost:3000/auth/logout"]
    }

    machine = {
      name            = "platform-dev-machine"
      generate_secret = true
      explicit_auth_flows = [
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH"
      ]
      allowed_oauth_flows  = []
      allowed_oauth_scopes = []
      callback_urls        = []
      logout_urls          = []
    }
  }

  tags = {
    Project     = "platform"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

## Inputs

| Name | Description | Type | Required |
|---|---|---|---|
| user_pool_name | Name of the user pool | string | yes |
| domain_prefix | Hosted UI domain prefix (globally unique) | string | yes |
| pre_token_generation_lambda_arn | ARN of Pre Token Generation Lambda | string | yes |
| password_policy | Password requirements | object | no |
| mfa_configuration | OFF / OPTIONAL / ON | string | no |
| advanced_security_mode | OFF / AUDIT / ENFORCED | string | no |
| deletion_protection | Prevent accidental deletion | bool | no |
| email_configuration | SES email config | object | no |
| app_clients | Map of app clients | map(object) | no |
| tags | Tags for all resources | map(string) | no |

## Outputs

| Name | Description |
|---|---|
| user_pool_id | User pool ID |
| user_pool_arn | User pool ARN |
| user_pool_endpoint | JWT issuer endpoint |
| jwks_uri | JWKS URI for API Gateway JWT authorizer |
| hosted_ui_domain | Hosted UI URL |
| app_client_ids | Map of logical name → client ID |
| app_client_secrets | Map of logical name → client secret (sensitive) |
