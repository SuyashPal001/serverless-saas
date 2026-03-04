output "queue_urls" {
  description = "Map of logical name → queue URL."
  value       = { for k, v in aws_sqs_queue.this : k => v.url }
}

output "queue_arns" {
  description = "Map of logical name → queue ARN."
  value       = { for k, v in aws_sqs_queue.this : k => v.arn }
}

output "queue_names" {
  description = "Map of logical name → queue name."
  value       = { for k, v in aws_sqs_queue.this : k => v.name }
}

output "dlq_urls" {
  description = "Map of logical name → DLQ URL (only for queues with create_dlq = true)."
  value       = { for k, v in aws_sqs_queue.dlq : k => v.url }
}

output "dlq_arns" {
  description = "Map of logical name → DLQ ARN (only for queues with create_dlq = true)."
  value       = { for k, v in aws_sqs_queue.dlq : k => v.arn }
}

output "dlq_names" {
  description = "Map of logical name → DLQ name (only for queues with create_dlq = true)."
  value       = { for k, v in aws_sqs_queue.dlq : k => v.name }
}
