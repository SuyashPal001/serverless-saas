# api-gateway/aws/http-api

Creates an API Gateway HTTP API v2 with JWT authorizer, Lambda integrations, and routes.

## What it creates
- HTTP API v2 (not REST API — HTTP API is cheaper and faster for Lambda proxy)
- JWT authorizer backed by Cognito
- `$default` stage with auto-deploy and access logging
- One Lambda integration per entry in `var.integrations`
- One route per entry in `var.routes`
- Lambda invoke permissions for each integration
- Optional custom domain with ACM certificate

## What it does NOT do
- Does not create Lambda functions — pass ARNs via `var.integrations`
- Does not create the CloudWatch log group — pass ARN via `access_log_group_arn`
- Does not create the Cognito user pool — pass issuer + audience via `jwt_authorizer`
- Does not write to SSM — outputs consumed by composition layer

## Design decisions

**HTTP API v2, not REST API** — HTTP API is ~70% cheaper, has lower latency, and
payload format v2.0 is required for Hono's Lambda adapter. REST API is only needed
for advanced features (WAF at gateway level, API keys, usage plans) — none of which
are needed at PMF stage.

**`payload_format_version = "2.0"`** — Hono's `handle` adapter expects v2.0 event
structure. Using v1.0 will cause the Lambda to receive a different event shape and
Hono routing will break silently.

**Single `$default` stage with `auto_deploy = true`** — eliminates the need to
manually trigger deployments after route/integration changes. Every Terraform apply
automatically deploys. Add explicit stages (staging, prod) when you need canary
deployments — not needed at PMF stage.

**Health check routes explicitly set `requires_auth = false`** — `/health` and
`/health/ready` must be reachable without a JWT for uptime monitoring and deployment
verification. All other routes default to JWT auth required.

**Per-route `requires_auth`** — rather than a global auth toggle, each route declares
its own auth requirement. This makes it impossible to accidentally expose a protected
route without auth.

**`timeout_milliseconds = 29000`** — API Gateway HTTP API maximum is 29 seconds.
Lambda max is 15 minutes. The gateway is always the bottleneck for synchronous HTTP
calls. Long-running work must go through SQS, not HTTP.

## Usage

```hcl
module "api_gateway" {
  source = "../../modules/api-gateway/aws/http-api"

  name        = "platform-dev"
  description = "Platform foundation HTTP API"

  access_log_group_arn = module.observability.log_group_arns["api_gateway"]

  jwt_authorizer = {
    issuer   = "https://${module.cognito.user_pool_endpoint}"
    audience = [module.cognito.app_client_ids["web"]]
  }

  throttling = {
    burst_limit = 500
    rate_limit  = 1000
  }

  cors = {
    allow_origins     = ["http://localhost:3000", "https://app.yourplatform.com"]
    allow_credentials = true
  }

  integrations = {
    foundation_api = {
      lambda_arn           = data.aws_ssm_parameter.foundation_api_lambda_arn.value
      timeout_milliseconds = 29000
    }
  }

  routes = {
    # Health — no auth
    health = {
      route_key       = "GET /health"
      integration_key = "foundation_api"
      requires_auth   = false
    }
    health_ready = {
      route_key       = "GET /health/ready"
      integration_key = "foundation_api"
      requires_auth   = false
    }

    # All foundation routes — JWT required
    foundation = {
      route_key       = "ANY /api/v1/{proxy+}"
      integration_key = "foundation_api"
      requires_auth   = true
    }
  }

  tags = {
    Project     = "platform"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

## Adding a new product

When Product A is split into its own Lambda:

```hcl
integrations = {
  foundation_api = { lambda_arn = "..." }
  helpdesk_api   = { lambda_arn = "..." }   # ← add integration
}

routes = {
  # existing routes ...
  helpdesk = {
    route_key       = "ANY /api/v1/helpdesk/{proxy+}"
    integration_key = "helpdesk_api"           # ← point to new integration
    requires_auth   = true
  }
}
```

No changes to any other module. Just add entries to these two maps and apply.

## Inputs

| Name | Description | Type | Required |
|---|---|---|---|
| name | API name | string | yes |
| access_log_group_arn | CloudWatch log group ARN for access logs | string | yes |
| jwt_authorizer | Cognito issuer + audience | object | yes |
| throttling | Burst and rate limits | object | no |
| cors | CORS configuration | object | no |
| integrations | Map of Lambda integrations | map(object) | no |
| routes | Map of routes | map(object) | no |
| custom_domain | Custom domain + ACM cert | object | no |
| tags | Tags for all resources | map(string) | no |

## Outputs

| Name | Description |
|---|---|
| api_id | HTTP API ID |
| api_arn | HTTP API ARN |
| api_endpoint | Default endpoint URL |
| execution_arn | Execution ARN for Lambda permissions |
| stage_id | Default stage ID |
| invoke_url | Full invoke URL |
| authorizer_id | JWT authorizer ID |
| custom_domain_target | CNAME target for custom domain DNS |
