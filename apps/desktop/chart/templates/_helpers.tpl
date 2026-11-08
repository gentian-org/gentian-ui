{{- define "gentian-portal.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "gentian-portal.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "gentian-portal.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "gentian-portal.labels" -}}
app.kubernetes.io/name: {{ include "gentian-portal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "gentian-portal.podSecurityContext" -}}
runAsNonRoot: {{ .Values.podSecurity.runAsNonRoot }}
runAsUser: {{ .Values.podSecurity.runAsUser }}
fsGroup: {{ .Values.podSecurity.fsGroup }}
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "gentian-portal.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop:
    - ALL
{{- end }}

{{/*
Whether the platform delivered this desktop a model gateway: it says there is
one, where, and in which Secret this desktop's key is. Non-empty when all
three are there. Tolerant of values that are missing altogether, as they are
when an older platform installs this chart.
*/}}
{{- define "gentian-portal.llmDelivered" -}}
{{- $llm := default dict .Values.llm -}}
{{- if and (eq (toString $llm.available) "true") $llm.baseUrl $llm.apiKeySecretName -}}
true
{{- end -}}
{{- end -}}
