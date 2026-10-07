{{- define "app-store.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
The name every object of this release is derived from. A ComponentProfile
routes to Services by name, so the name has to be stable and known before the
release exists: fullnameOverride is how a profile pins it, and the operator
installs the release under the Component's name, which is the profile's.
Without an override it is <release>-<chart>, the Helm convention.
*/}}
{{- define "app-store.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "app-store.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "app-store.labels" -}}
app.kubernetes.io/name: {{ include "app-store.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "app-store.podSecurityContext" -}}
runAsNonRoot: {{ .Values.podSecurity.runAsNonRoot }}
runAsUser: {{ .Values.podSecurity.runAsUser }}
fsGroup: {{ .Values.podSecurity.fsGroup }}
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "app-store.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop:
    - ALL
{{- end }}
