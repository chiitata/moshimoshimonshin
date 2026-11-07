# Issue #39: opt-in monitoring. No runtime/IAM/notification channel changes.
variable "enable_api_monitoring" {
  type        = bool
  default     = false
  description = "Create API log metrics, SLO, dashboard and alert policies after reviewing metric cost and ownership."
}

variable "monitoring_notification_channels" {
  type        = list(string)
  default     = []
  description = "Existing verified channel resource names in this project. Empty keeps alert policies disabled."
  validation {
    condition     = alltrue([for channel in var.monitoring_notification_channels : can(regex("^projects/[^/]+/notificationChannels/[0-9]+$", channel))])
    error_message = "Use full existing projects/PROJECT/notificationChannels/ID names."
  }
}

locals {
  # Cloud Run request logs only; do not extract paths, query strings, UID or body
  # into metric labels. Exclude the LLM endpoint and preflight/health traffic.
  api_request_log_filter = join("\n", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.project_id=\"${var.project_id}\"",
    "resource.labels.location=\"${var.region}\"",
    "resource.labels.service_name=\"api\"",
    "logName=\"projects/${var.project_id}/logs/run.googleapis.com%2Frequests\"",
    "httpRequest.requestUrl =~ \"^https?://[^/]+/v1/\"",
    "NOT httpRequest.requestUrl =~ \"/v1/intakes/[^/?]+/next-question([?]|$)\"",
    "httpRequest.requestMethod != \"OPTIONS\"",
    "httpRequest.status >= 100",
  ])
  api_metric_resource_filter = "resource.type=\"cloud_run_revision\" resource.labels.project_id=\"${var.project_id}\" resource.labels.location=\"${var.region}\" resource.labels.service_name=\"api\""
  api_request_metric_filter  = "metric.type=\"logging.googleapis.com/user/mmr_api_non_llm_requests\" ${local.api_metric_resource_filter}"
  api_error_metric_filter    = "metric.type=\"logging.googleapis.com/user/mmr_api_non_llm_5xx\" ${local.api_metric_resource_filter}"
  api_latency_metric_filter  = "metric.type=\"logging.googleapis.com/user/mmr_api_non_llm_latency\" ${local.api_metric_resource_filter}"
}

resource "google_logging_metric" "api_counts" {
  for_each = var.enable_api_monitoring ? {
    requests = { name = "mmr_api_non_llm_requests", extra = "" }
    errors   = { name = "mmr_api_non_llm_5xx", extra = "\nhttpRequest.status >= 500\nhttpRequest.status < 600" }
  } : {}
  project = var.project_id
  name    = each.value.name
  filter  = "${local.api_request_log_filter}${each.value.extra}"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "api_latency" {
  count           = var.enable_api_monitoring ? 1 : 0
  project         = var.project_id
  name            = "mmr_api_non_llm_latency"
  filter          = "${local.api_request_log_filter}\nhttpRequest.latency:*"
  value_extractor = "REGEXP_EXTRACT(httpRequest.latency, \"([0-9.]+)s\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "s"
  }
  bucket_options {
    explicit_buckets {
      bounds = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 8, 15, 30, 60, 120, 300]
    }
  }
}

resource "google_monitoring_custom_service" "api" {
  count        = var.enable_api_monitoring ? 1 : 0
  project      = var.project_id
  service_id   = "mmr-api-non-llm"
  display_name = "API non-LLM availability"
}

resource "google_monitoring_slo" "api_availability" {
  count               = var.enable_api_monitoring ? 1 : 0
  project             = var.project_id
  service             = google_monitoring_custom_service.api[0].service_id
  slo_id              = "availability-995"
  display_name        = "Non-LLM API non-5xx / 30 days >= 99.5%"
  goal                = 0.995
  rolling_period_days = 30
  request_based_sli {
    good_total_ratio {
      bad_service_filter   = local.api_error_metric_filter
      total_service_filter = local.api_request_metric_filter
    }
  }
  depends_on = [google_logging_metric.api_counts]
}

resource "google_monitoring_alert_policy" "api_errors" {
  count                 = var.enable_api_monitoring ? 1 : 0
  project               = var.project_id
  display_name          = "API non-LLM 5xx ratio > 2%"
  combiner              = "OR"
  enabled               = length(var.monitoring_notification_channels) > 0
  notification_channels = var.monitoring_notification_channels
  documentation {
    mime_type = "text/markdown"
    content   = "SEV2 candidate: non-LLM API 5xx ratio exceeds 2%. Check revisions and error codes using requestId, without copying payloads or identifiers. Confirm patient impact and follow docs/02 section 13.3. No data is not recovery evidence."
  }
  conditions {
    display_name = "5-minute error/request ratio sustained for 5 minutes"
    condition_threshold {
      filter             = local.api_error_metric_filter
      denominator_filter = local.api_request_metric_filter
      comparison         = "COMPARISON_GT"
      threshold_value    = 0.02
      duration           = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      denominator_aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"
      trigger { count = 1 }
    }
  }
  lifecycle {
    precondition {
      condition     = alltrue([for channel in var.monitoring_notification_channels : startswith(channel, "projects/${var.project_id}/notificationChannels/")])
      error_message = "Notification channels must belong to this project (use its project ID, not project number)."
    }
  }
  depends_on = [google_logging_metric.api_counts]
}

resource "google_monitoring_alert_policy" "api_latency" {
  count                 = var.enable_api_monitoring ? 1 : 0
  project               = var.project_id
  display_name          = "API non-LLM revision p95 > 1.5 seconds"
  combiner              = "OR"
  enabled               = length(var.monitoring_notification_channels) > 0
  notification_channels = var.monitoring_notification_channels
  documentation {
    mime_type = "text/markdown"
    content   = "SEV3 candidate; escalate to SEV2 for sustained patient impact. Worst revision-level p95 over 5 minutes, not a global percentile. Check cold start, dependency latency and deployment changes. No payload/URL/UID in tickets. No-data intervals need separate investigation."
  }
  conditions {
    display_name = "Worst revision-level 5-minute p95 > 1.5s for 5 minutes"
    condition_threshold {
      filter          = local.api_latency_metric_filter
      comparison      = "COMPARISON_GT"
      threshold_value = 1.5
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
      }
      evaluation_missing_data = "EVALUATION_MISSING_DATA_NO_OP"
      trigger { count = 1 }
    }
  }
  lifecycle {
    precondition {
      condition     = alltrue([for channel in var.monitoring_notification_channels : startswith(channel, "projects/${var.project_id}/notificationChannels/")])
      error_message = "Notification channels must belong to this project (use its project ID, not project number)."
    }
  }
  depends_on = [google_logging_metric.api_latency]
}

resource "google_monitoring_dashboard" "api" {
  count   = var.enable_api_monitoring ? 1 : 0
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "API non-LLM operations"
    gridLayout = {
      columns = "2"
      widgets = concat([for chart in [
        { title = "Non-LLM request rate", filter = local.api_request_metric_filter },
        { title = "Non-LLM 5xx rate", filter = local.api_error_metric_filter },
        ] : {
        title = chart.title
        xyChart = {
          dataSets = [{
            plotType = "LINE"
            timeSeriesQuery = { timeSeriesFilter = {
              filter      = chart.filter
              aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_RATE", crossSeriesReducer = "REDUCE_SUM" }
            } }
          }]
          yAxis = { scale = "LINEAR" }
        }
        }], [{
        title = "Worst revision p95 latency (seconds)"
        xyChart = {
          dataSets = [{
            plotType = "LINE"
            timeSeriesQuery = { timeSeriesFilter = {
              filter      = local.api_latency_metric_filter
              aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_PERCENTILE_95", crossSeriesReducer = "REDUCE_MAX" }
            } }
          }]
          yAxis = { scale = "LINEAR" }
        }
        }, {
        title = "Scope and readiness"
        text = {
          format  = "MARKDOWN"
          content = "30-day non-5xx request SLO: 99.5%. Excludes next-question and OPTIONS; includes 4xx. Sparse/no data is not success. Alerts stay disabled until verified notification channels are configured. See infra/monitoring/README.md for acceptance and remaining job/question/deletion monitoring."
        }
      }])
    }
  })
  depends_on = [google_logging_metric.api_counts, google_logging_metric.api_latency]
}
