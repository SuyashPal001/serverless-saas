# messaging/aws/sns

Creates SNS topics, topic policies, and subscriptions.

## What it creates
- One SNS topic per entry in `var.topics`
- One topic policy per topic (account owner + optional EventBridge/Lambda publishers)
- One subscription per entry in each topic's `subscriptions` map

## What it does NOT do
- Does not create SQS queues — pass queue ARNs as subscription endpoints
- Does not create Lambda functions — pass Lambda ARNs as subscription endpoints
- Does not write to SSM — outputs consumed by composition layer

## Design decisions
- Topic policy always grants account root publish access — safe baseline
- EventBridge and Lambda publisher grants are conditional — only added when ARNs provided
- Subscriptions are flattened from nested map using `merge([for...])` — allows multiple
  subscriptions per topic without nested for_each complexity
- `raw_message_delivery = false` by default — SNS wraps message in envelope. Set true
  for SQS subscribers that need raw JSON (e.g. your worker Lambdas)
- `filter_policy` supported per subscription — fan-out by event category without
  creating separate topics

## Usage

```hcl
module "sns" {
  source = "../../modules/messaging/aws/sns"

  topics = {
    # Platform events fan-out — fires on any platform event
    events = {
      name         = "platform-dev-events"
      display_name = "Platform Events"

      subscriptions = {
        # Fan out to notification worker queue
        notifications_queue = {
          protocol             = "sqs"
          endpoint             = module.sqs.queue_arns["notifications"]
          raw_message_delivery = true
        }
      }
    }

    # Ops alerts — DLQ depth, cross-tenant attempts, errors
    alerts = {
      name         = "platform-dev-alerts"
      display_name = "Platform Alerts"

      allowed_eventbridge_bus_arns = [
        "arn:aws:events:ap-south-1:123456789:event-bus/platform-dev"
      ]

      subscriptions = {
        ops_email = {
          protocol = "email"
          endpoint = "ops@yourcompany.com"
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
| topics | Map of SNS topics to create | map(object) | no |
| tags | Tags to apply to all resources | map(string) | no |

### Topic object fields

| Field | Description | Default |
|---|---|---|
| name | Physical topic name in AWS | required |
| display_name | Human readable name | null |
| fifo | Create as FIFO topic | false |
| kms_key_id | KMS key for encryption | null |
| allowed_eventbridge_bus_arns | EventBridge buses allowed to publish | [] |
| allowed_lambda_arns | Lambda functions allowed to publish | [] |
| subscriptions | Map of subscriptions for this topic | {} |

### Subscription object fields

| Field | Description | Default |
|---|---|---|
| protocol | sqs / lambda / email / https | required |
| endpoint | Queue ARN / Lambda ARN / email / URL | required |
| raw_message_delivery | Skip SNS envelope (SQS only) | false |
| filter_policy | SNS filter policy for fan-out | null |

## Outputs

| Name | Description |
|---|---|
| topic_arns | Map of logical name → topic ARN |
| topic_names | Map of logical name → topic name |
| subscription_arns | Map of topic_key:sub_key → subscription ARN |
