# messaging/aws/eventbridge

Creates custom EventBridge buses, rules, and targets.

## What it creates
- One custom event bus per entry in `var.buses`
- Bus policy if `allowed_principal_arns` is provided
- Event rules (pattern or schedule) per bus
- Event targets per rule

## What it does NOT do
- Does not create Lambda functions or SQS queues — pass ARNs as target arns
- Does not create IAM roles for targets — pass role_arn per target
- Does not write to SSM — outputs consumed by composition layer

## Design decisions
- Buses, rules, and targets are all nested under `var.buses` — one variable describes
  the full topology. No need to wire separate module outputs together.
- Both `event_pattern` and `schedule_expression` supported per rule — pattern-based
  for event-driven triggers, schedule for cron jobs (usage aggregation, trial expiry checks)
- `input_transformer` supported per target — reshape event payload before it hits
  the target, avoids Lambda having to parse raw EventBridge envelopes
- Bus policy only created when `allowed_principal_arns` is non-empty

## Usage

```hcl
module "eventbridge" {
  source = "../../modules/messaging/aws/eventbridge"

  buses = {
    platform = {
      name = "platform-dev"

      rules = {
        # Scheduled — nightly usage aggregation
        usage_aggregation = {
          name                = "platform-dev-usage-aggregation"
          description         = "Triggers nightly usage aggregation worker"
          schedule_expression = "cron(0 0 * * ? *)"  # midnight UTC daily

          targets = {
            worker_queue = {
              target_id = "usage-aggregation-queue"
              arn       = module.sqs.queue_arns["processing"]
              role_arn  = aws_iam_role.eventbridge_sqs.arn
            }
          }
        }

        # Scheduled — check and expire feature overrides
        override_expiry = {
          name                = "platform-dev-override-expiry"
          description         = "Checks for expired tenant feature overrides"
          schedule_expression = "rate(1 hour)"

          targets = {
            worker_queue = {
              target_id = "override-expiry-queue"
              arn       = module.sqs.queue_arns["processing"]
              role_arn  = aws_iam_role.eventbridge_sqs.arn
            }
          }
        }

        # Pattern-based — tenant suspended event
        tenant_suspended = {
          name        = "platform-dev-tenant-suspended"
          description = "Routes tenant.suspended events to processing queue"

          event_pattern = {
            source      = ["platform.foundation"]
            detail-type = ["tenant.suspended"]
          }

          targets = {
            processing_queue = {
              target_id = "tenant-suspended-queue"
              arn       = module.sqs.queue_arns["processing"]
              role_arn  = aws_iam_role.eventbridge_sqs.arn
            }
          }
        }
      }
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
| buses | Map of event buses with rules and targets | map(object) | no |
| tags | Tags to apply to all resources | map(string) | no |

### Bus object fields

| Field | Description | Default |
|---|---|---|
| name | Physical bus name in AWS | required |
| allowed_principal_arns | IAM principals allowed to put events | [] |
| rules | Map of rules for this bus | {} |

### Rule object fields

| Field | Description | Default |
|---|---|---|
| name | Physical rule name in AWS | required |
| description | Rule description | null |
| enabled | Enable or disable the rule | true |
| event_pattern | Event pattern map (jsonencoded internally) | null |
| schedule_expression | cron() or rate() expression | null |
| targets | Map of targets for this rule | {} |

### Target object fields

| Field | Description | Default |
|---|---|---|
| target_id | Unique target identifier within the rule | required |
| arn | Destination ARN (Lambda / SQS / SNS) | required |
| role_arn | IAM role EventBridge assumes to invoke target | null |
| message_group_id | FIFO SQS message group ID | null |
| input_transformer | Reshape payload before delivery | null |

## Outputs

| Name | Description |
|---|---|
| bus_arns | Map of logical name → event bus ARN |
| bus_names | Map of logical name → event bus name |
| rule_arns | Map of bus_key:rule_key → rule ARN |
| rule_names | Map of bus_key:rule_key → rule name |
