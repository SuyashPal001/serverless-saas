output "role_arns" {
  description = "Map of logical name → role ARN."
  value       = { for k, v in aws_iam_role.this : k => v.arn }
}

output "role_names" {
  description = "Map of logical name → role name."
  value       = { for k, v in aws_iam_role.this : k => v.name }
}

output "role_ids" {
  description = "Map of logical name → role unique ID."
  value       = { for k, v in aws_iam_role.this : k => v.unique_id }
}
