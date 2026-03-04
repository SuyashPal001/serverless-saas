output "log_group_names" {
  description = "Map of logical name → CloudWatch log group name."
  value       = { for k, v in aws_cloudwatch_log_group.this : k => v.name }
}

output "log_group_arns" {
  description = "Map of logical name → CloudWatch log group ARN."
  value       = { for k, v in aws_cloudwatch_log_group.this : k => v.arn }
}

output "metric_alarm_arns" {
  description = "Map of logical name → CloudWatch alarm ARN."
  value       = { for k, v in aws_cloudwatch_metric_alarm.this : k => v.arn }
}
