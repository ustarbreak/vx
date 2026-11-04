from pymisp import PyMISP
from typing import List, Dict
from datetime import datetime, timedelta


class MISPService:
    """MISP client. TLS verification is enabled by default.

    `verify_ssl` may be a CA bundle path for private PKI deployments.
    """
    def __init__(self, url: str, api_key: str, verify_ssl: bool | str = True):
        self.misp = PyMISP(url, api_key, ssl=verify_ssl)

    async def search_iocs(self, event_id: str = None, value: str = None,
                          type_attribute: str = None) -> List[Dict]:
        search_params = {}
        if event_id: search_params["event_id"] = event_id
        if value: search_params["value"] = value
        if type_attribute: search_params["type_attribute"] = type_attribute
        results = self.misp.search(**search_params)
        iocs = []
        for event in results:
            for attr in event["Event"]["Attribute"]:
                iocs.append({"id": attr["id"], "event_id": event["Event"]["id"],
                             "type": attr["type"], "value": attr["value"],
                             "category": attr["category"], "comment": attr.get("comment", ""),
                             "timestamp": attr["timestamp"]})
        return iocs

    async def publish_ioc(self, ioc_type: str, value: str, category: str,
                          threat_level: int = 2, comment: str = "") -> Dict:
        event = self.misp.new_event(threat_level_id=threat_level, analysis=1,
                                    info=f"New {ioc_type} from Infracentra")
        attribute = self.misp.add_attribute(event["Event"]["id"], {
            "type": ioc_type, "value": value, "category": category, "comment": comment})
        return {"id": attribute["Attribute"]["id"], "event_id": event["Event"]["id"],
                "type": ioc_type, "value": value}

    async def get_recent_events(self, hours: int = 24) -> List[Dict]:
        last = datetime.utcnow() - timedelta(hours=hours)
        results = self.misp.search(date_from=last.isoformat())
        return [{"id": event["Event"]["id"], "info": event["Event"]["info"],
                 "threat_level": event["Event"]["threat_level_id"],
                 "timestamp": event["Event"]["timestamp"],
                 "attribute_count": len(event["Event"]["Attribute"])} for event in results]

    async def close(self):
        # PyMISP does not expose a stable public async close API.
        pass
