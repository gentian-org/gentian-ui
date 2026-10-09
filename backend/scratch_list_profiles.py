from app.services.k8s_catalogue import _custom_objects_api, GROUP, VERSION
profiles = _custom_objects_api().list_cluster_custom_object(GROUP, VERSION, "appprofiles")
for p in profiles.get("items", []):
    print(p["metadata"]["name"])
