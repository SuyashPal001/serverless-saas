output "topic_arns" {
  description = "Map of logical name → SNS topic ARN."
  value       = { for k, v in aws_sns_topic.this : k => v.arn }
}

output "topic_names" {
  description = "Map of logical name → SNS topic name."
  value       = { for k, v in aws_sns_topic.this : k => v.name }
}

output "subscription_arns" {
  description = "Map of 'topic_key:sub_key' → subscription ARN."
  value       = { for k, v in aws_sns_topic_subscription.this : k => v.arn }
}
