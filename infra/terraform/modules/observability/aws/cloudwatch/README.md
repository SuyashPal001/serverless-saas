# observability/aws/cloudwatch

Creates CloudWatch Log Groups and Metric Alarms.

## What it creates
- One log group per entry in `var.log_groups`
- One metric alarm per entry in `var.metric_alarms`

## What it does NOT do
- Does not write to SSM — outputs are consumed by the composition layer
- Does not create SNS topics — pass alarm action ARNs in via `alarm_actions`

## Usage

```hcl
module "observability" {
  source = "../../modules/observability/aws/cloudwatch"

  log_groups = {
    api_lambda = {
      name              = "/aws/lambda/platform-foundation-api-dev"
      retention_in_days = 30
    }
    worker_lambda = {
      name              = "/aws/lambda/platform-foundation-worker-dev"
      retention_in_days = 30
    }
    pretoken_lambda = {
      name              = "/aws/lambda/platform-foundation-pretoken-dev"
      retention_in_days = 30
    }
    api_gateway = {
      name              = "/aws/apigateway/platform-dev"
      retention_in_days = 30
    }
  }

  metric_alarms = {
    dlq_depth = {
      alarm_name          = "platform-dev-dlq-depth"
      alarm_description   = "Messages in DLQ — indicates failed processing"
      comparison_operator = "GreaterThanThreshold"
      evaluation_periods  = 1
      metric_name         = "ApproximateNumberOfMessagesVisible"
      namespace           = "AWS/SQS"
      period              = 60
      statistic           = "Sum"
      threshold           = 0
      dimensions          = { QueueName = "platform-dev-dlq" }
      alarm_actions       = ["arn:aws:sns:ap-south-1:123456789:platform-dev-alerts"]
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
| log_groups | Map of log groups to create | map(object) | no |
| metric_alarms | Map of metric alarms to create | map(object) | no |
| tags | Tags to apply to all resources | map(string) | no |

## Outputs

| Name | Description |
|---|---|
| log_group_names | Map of logical name → log group name |
| log_group_arns | Map of logical name → log group ARN |
| metric_alarm_arns | Map of logical name → alarm ARN |
