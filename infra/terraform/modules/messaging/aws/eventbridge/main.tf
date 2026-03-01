locals {
  # Flatten rules across all buses
  # Input:  { bus_key: { rules: { rule_key: { ... } } } }
  # Output: { "bus_key:rule_key": { bus_key, ...rule_config } }
  rules = merge([
    for bus_key, bus in var.buses : {
      for rule_key, rule in bus.rules :
      "${bus_key}:${rule_key}" => merge(rule, { bus_key = bus_key })
    }
  ]...)

  # Flatten targets across all rules
  # Input:  { bus_key: { rules: { rule_key: { targets: { target_key: { ... } } } } } }
  # Output: { "bus_key:rule_key:target_key": { bus_key, rule_key, ...target_config } }
  targets = merge([
    for bus_key, bus in var.buses : merge([
      for rule_key, rule in bus.rules : {
        for target_key, target in rule.targets :
        "${bus_key}:${rule_key}:${target_key}" => merge(target, {
          bus_key  = bus_key
          rule_key = "${bus_key}:${rule_key}"
        })
      }
    ]...)
  ]...)
}

# -------------------------------------------------------
# Custom Event Buses
# -------------------------------------------------------
resource "aws_cloudwatch_event_bus" "this" {
  for_each = var.buses

  name = each.value.name

  tags = merge(var.tags, {
    Name = each.key
  })
}

# -------------------------------------------------------
# Event Bus Policy
# Controls who can put events onto each bus
# -------------------------------------------------------
resource "aws_cloudwatch_event_bus_policy" "this" {
  for_each = {
    for k, v in var.buses : k => v if length(v.allowed_principal_arns) > 0
  }

  event_bus_name = aws_cloudwatch_event_bus.this[each.key].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPutEvents"
        Effect = "Allow"
        Principal = {
          AWS = each.value.allowed_principal_arns
        }
        Action   = "events:PutEvents"
        Resource = aws_cloudwatch_event_bus.this[each.key].arn
      }
    ]
  })
}

# -------------------------------------------------------
# Event Rules
# Pattern-based or schedule-based triggers
# -------------------------------------------------------
resource "aws_cloudwatch_event_rule" "this" {
  for_each = local.rules

  name           = each.value.name
  description    = each.value.description
  event_bus_name = aws_cloudwatch_event_bus.this[each.value.bus_key].name
  state          = each.value.enabled ? "ENABLED" : "DISABLED"

  # Exactly one of event_pattern or schedule_expression must be set
  event_pattern       = each.value.event_pattern != null ? jsonencode(each.value.event_pattern) : null
  schedule_expression = each.value.schedule_expression

  tags = merge(var.tags, {
    Name = each.key
  })
}

# -------------------------------------------------------
# Event Targets
# Where matched events are sent
# -------------------------------------------------------
resource "aws_cloudwatch_event_target" "this" {
  for_each = local.targets

  rule           = aws_cloudwatch_event_rule.this[each.value.rule_key].name
  event_bus_name = aws_cloudwatch_event_bus.this[each.value.bus_key].name
  target_id      = each.value.target_id
  arn            = each.value.arn
  role_arn       = each.value.role_arn

  dynamic "sqs_target" {
    for_each = each.value.message_group_id != null ? [1] : []
    content {
      message_group_id = each.value.message_group_id
    }
  }

  dynamic "input_transformer" {
    for_each = each.value.input_transformer != null ? [each.value.input_transformer] : []
    content {
      input_paths    = input_transformer.value.input_paths
      input_template = input_transformer.value.input_template
    }
  }
}
