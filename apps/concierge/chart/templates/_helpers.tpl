{{- define "concierge.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (default .Chart.Name .Values.nameOverride) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "concierge.selectorLabels" -}}
app.kubernetes.io/name: concierge
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "concierge.labels" -}}
{{ include "concierge.selectorLabels" . }}
app.kubernetes.io/part-of: gentian-os
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}
