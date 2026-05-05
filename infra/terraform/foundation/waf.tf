# -------------------------------------------------------
# WAF — Restrict /api/v1/internal/* to GCP relay IP(s)
# -------------------------------------------------------

resource "aws_wafv2_ip_set" "relay_allowlist" {
  name               = "${local.name_prefix}-relay-ip-allowlist"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = [for ip in var.relay_ip_allowlist : "${ip}/32"]
  tags               = {}
}

resource "aws_wafv2_web_acl" "internal_routes" {
  name  = "${local.name_prefix}-internal-routes"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rule 1 (priority 1): Allow /api/v1/internal/* from the relay IP set.
  rule {
    name     = "allow-relay-on-internal"
    priority = 1

    action {
      allow {}
    }

    statement {
      and_statement {
        statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }
            positional_constraint = "STARTS_WITH"
            search_string         = "/api/v1/internal/"
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
        statement {
          ip_set_reference_statement {
            arn = aws_wafv2_ip_set.relay_allowlist.arn
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-allow-relay-on-internal"
      sampled_requests_enabled   = true
    }
  }

  # Rule 2 (priority 2): Block /api/v1/internal/* from any other source.
  rule {
    name     = "block-internal-from-public"
    priority = 2

    action {
      block {}
    }

    statement {
      byte_match_statement {
        field_to_match {
          uri_path {}
        }
        positional_constraint = "STARTS_WITH"
        search_string         = "/api/v1/internal/"
        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-block-internal-from-public"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-internal-routes-acl"
    sampled_requests_enabled   = true
  }

  tags = {}
}

resource "aws_wafv2_web_acl_association" "api_gateway" {
  resource_arn = "arn:aws:apigateway:${var.region}::/apis/${module.api_gateway.api_id}/stages/$default"
  web_acl_arn  = aws_wafv2_web_acl.internal_routes.arn
}
