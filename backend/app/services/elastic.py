from elasticsearch import AsyncElasticsearch
from typing import List, Dict
from datetime import datetime, timedelta


class ElasticService:
    """Elastic Security client with certificate verification enabled by default.

    `ca_certs` accepts a PEM CA bundle path for private PKI deployments.
    """
    def __init__(self, url: str, api_key: str, ca_certs: str | None = None):
        self.es = AsyncElasticsearch(hosts=[url], api_key=api_key, request_timeout=30,
                                     verify_certs=True, ca_certs=ca_certs)

    async def search_logs(self, query: str, index: str = "logs-*", hours: int = 24,
                          size: int = 100) -> List[Dict]:
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        body = {"query": {"bool": {"must": [{"query_string": {"query": query}}],
                "filter": [{"range": {"@timestamp": {"gte": start_time.isoformat() + "Z",
                                                          "lte": end_time.isoformat() + "Z"}}}]}},
                "size": size, "sort": [{"@timestamp": {"order": "desc"}}]}
        response = await self.es.search(index=index, body=body)
        return [{"id": hit["_id"], "timestamp": hit["_source"]["@timestamp"],
                 "message": hit["_source"].get("message", ""),
                 "source": hit["_source"].get("agent", {}).get("name", ""),
                 "severity": hit["_source"].get("log", {}).get("level", "info"),
                 "raw": hit["_source"]} for hit in response["hits"]["hits"]]

    async def create_security_case(self, title: str, description: str, severity: str,
                                   assignee: str = None) -> Dict:
        case = {"title": title, "description": description, "severity": severity,
                "status": "open", "created_at": datetime.utcnow().isoformat() + "Z",
                "created_by": "infracentra"}
        if assignee: case["assignee"] = assignee
        response = await self.es.index(index=".siem-signals-default", body=case, refresh=True)
        return {"id": response["_id"], "title": title, "severity": severity, "status": "open"}

    async def get_cases(self, status: str = "open", severity: str = None) -> List[Dict]:
        query = {"bool": {"must": [{"term": {"status": status}}]}}
        if severity: query["bool"]["must"].append({"term": {"severity": severity}})
        response = await self.es.search(index=".siem-signals-default", body={"query": query, "size": 100})
        return [{"id": hit["_id"], "title": hit["_source"]["title"],
                 "description": hit["_source"]["description"], "severity": hit["_source"]["severity"],
                 "status": hit["_source"]["status"], "created_at": hit["_source"]["created_at"]}
                for hit in response["hits"]["hits"]]

    async def close(self):
        await self.es.close()
