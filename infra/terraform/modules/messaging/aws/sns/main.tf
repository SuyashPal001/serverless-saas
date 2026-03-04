locals {
  # Flatten subscriptions map for for_each
  # Input:  { topic_key: { subscriptions: { sub_key: { protocol, endpoint } } } }
  # Output: { "topic_key:sub_key": { topic_key, protocol, endpoint } }
  subscriptions = merge([
    for topic_key, topic in var.topics : {
      for sub_key, sub in topic.subscriptions :
      "${topic_key}:${sub_key}" => {
        topic_key = topic_key
        protocol  = sub.protocol
        endpoint  = sub.endpoint
        raw_message_delivery = lookup(sub, "raw_message_delivery", false)
        filter_policy        = lookup(sub, "filter_policy", null)
      }
    }
  ]...)
}

# -------------------------------------------------------
# SNS Topics
# -------------------------------------------------------
resource "aws_sns_topic" "this" {
  for_each = var.topics

  name              = "${each.value.name}${each.value.fifo ? ".fifo" : ""}"
  fifo_topic        = each.value.fifo
  kms_master_key_id = each.value.kms_key_id
  display_name      = each.value.display_name

  tags = merge(var.tags, {
    Name = each.key
  })
}

# -------------------------------------------------------
# SNS Topic Policy
# Controls who can publish to each topic
# -------------------------------------------------------
resource "aws_sns_topic_policy" "this" {
  for_each = var.topics

  arn = aws_sns_topic.this[each.key].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      # Always allow the account owner
      [
        {
          Sid       = "AllowAccountPublish"
          Effect    = "Allow"
          Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
          Action    = ["sns:Publish", "sns:Subscribe", "sns:Receive"]
          Resource  = aws_sns_topic.this[each.key].arn
        }
      ],
      # Allow EventBridge if specified
      length(each.value.allowed_eventbridge_bus_arns) > 0 ? [
        {
          Sid       = "AllowEventBridgePublish"
          Effect    = "Allow"
          Principal = { Service = "events.amazonaws.com" }
          Action    = "sns:Publish"
          Resource  = aws_sns_topic.this[each.key].arn
          Condition = {
            ArnLike = {
              "aws:SourceArn" = each.value.allowed_eventbridge_bus_arns
            }
          }
        }
      ] : [],
      # Allow Lambda if specified
      length(each.value.allowed_lambda_arns) > 0 ? [
        {
          Sid       = "AllowLambdaPublish"
          Effect    = "Allow"
          Principal = { Service = "lambda.amazonaws.com" }
          Action    = "sns:Publish"
          Resource  = aws_sns_topic.this[each.key].arn
          Condition = {
            ArnLike = {
              "aws:SourceArn" = each.value.allowed_lambda_arns
            }
          }
        }
      ] : []
    )
  })
}

# -------------------------------------------------------
# SNS Subscriptions
# Flattened from per-topic subscription maps
# -------------------------------------------------------
resource "aws_sns_topic_subscription" "this" {
  for_each = local.subscriptions

  topic_arn            = aws_sns_topic.this[each.value.topic_key].arn
  protocol             = each.value.protocol
  endpoint             = each.value.endpoint
  raw_message_delivery = each.value.raw_message_delivery

  filter_policy = each.value.filter_policy != null ? jsonencode(each.value.filter_policy) : null
}

# -------------------------------------------------------
# Data sources
# -------------------------------------------------------
data "aws_caller_identity" "current" {}
