# messaging/aws/sqs

Creates SQS queues with optional DLQs and SNS-to-SQS queue policies.

## What it creates
- One main queue per entry in `var.queues`
- One DLQ per queue where `create_dlq = true` (default: true)
- Queue policy allowing SNS publish if `allowed_sns_topic_arns` is provided

## What it does NOT do
- Does not create SNS topics — pass ARNs via `allowed_sns_topic_arns`
- Does not create event source mappings — that is module 7
- Does not write to SSM — outputs consumed by composition layer

## Design decisions
- DLQ created before main queue — main queue redrive policy references DLQ ARN
- Long polling enabled by default (`receive_wait_time_seconds = 20`) — reduces empty receives and cost
- `max_receive_count = 3` default — message moves to DLQ after 3 failed attempts
- Queue policy only created when `allowed_sns_topic_arns` is non-empty — no unnecessary IAM noise

## Usage

```hcl
module "sqs" {
  source = "../../modules/messaging/aws/sqs"

  queues = {
    # Short job worker — email, webhooks, audit log
    processing = {
      name                       = "platform-dev-processing"
      visibility_timeout_seconds = 30
      max_receive_count          = 3
      create_dlq                 = true
    }

    # Agent workflow queue — longer timeout for multi-step agent runs
    workflow = {
      name                       = "platform-dev-workflow"
      visibility_timeout_seconds = 900  # 15 min — matches Lambda max timeout
      max_receive_count          = 3
      create_dlq                 = true
    }

    # Notification queue — triggered by SNS fan-out
    notifications = {
      name                       = "platform-dev-notifications"
      visibility_timeout_seconds = 30
      max_receive_count          = 3
      create_dlq                 = true
      allowed_sns_topic_arns     = ["arn:aws:sns:ap-south-1:123456789:platform-dev-events"]
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
| queues | Map of queues to create | map(object) | no |
| tags | Tags to apply to all resources | map(string) | no |

### Queue object fields

| Field | Description | Default |
|---|---|---|
| name | Physical queue name in AWS | required |
| fifo | Create as FIFO queue | false |
| visibility_timeout_seconds | How long message hidden after receive | 30 |
| message_retention_seconds | How long SQS retains message | 345600 (4 days) |
| delay_seconds | Delay before message is available | 0 |
| max_message_size | Max message size in bytes | 262144 (256KB) |
| receive_wait_time_seconds | Long poll wait time | 20 |
| kms_key_id | KMS key for encryption at rest | null |
| create_dlq | Create a DLQ for this queue | true |
| max_receive_count | Failures before moving to DLQ | 3 |
| allowed_sns_topic_arns | SNS topic ARNs allowed to publish | [] |

## Outputs

| Name | Description |
|---|---|
| queue_urls | Map of logical name → queue URL |
| queue_arns | Map of logical name → queue ARN |
| queue_names | Map of logical name → queue name |
| dlq_urls | Map of logical name → DLQ URL |
| dlq_arns | Map of logical name → DLQ ARN |
| dlq_names | Map of logical name → DLQ name |
