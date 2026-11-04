import httpx
from typing import List, Dict, Optional
from datetime import datetime, timedelta


class WazuhService:
    """Wazuh API client. TLS verification is enabled by default.

    `verify_ssl` may be a CA bundle path for private PKI deployments.
    """
    def __init__(self, base_url: str, api_user: str, api_password: str,
                 verify_ssl: bool | str = True):
        self.base_url = base_url.rstrip('/')
        self.auth = (api_user, api_password)
        self.client = httpx.AsyncClient(timeout=30.0, verify=verify_ssl)

    async def get_agents(self, org_id: str = None) -> List[Dict]:
        params = {"limit": 1000, "select": "id,name,ip,status,os,version"}
        if org_id:
            params["group"] = org_id
        response = await self.client.get(f"{self.base_url}/agents", auth=self.auth, params=params)
        response.raise_for_status()
        return response.json().get("data", {}).get("affected_items", [])

    async def get_alerts(self, level: int = 7, hours: int = 24, agent_id: str = None) -> List[Dict]:
        params = {"level__gte": level, "limit": 500, "sort": "-timestamp"}
        if agent_id:
            params["agent_id"] = agent_id
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        params["date_from"] = start_time.isoformat() + "Z"
        params["date_to"] = end_time.isoformat() + "Z"
        response = await self.client.get(f"{self.base_url}/alerts", auth=self.auth, params=params)
        response.raise_for_status()
        return response.json().get("data", {}).get("affected_items", [])

    async def isolate_agent(self, agent_id: str) -> Dict:
        response = await self.client.put(f"{self.base_url}/agents/{agent_id}/restart",
                                          auth=self.auth, json={"isolate": True})
        response.raise_for_status()
        return {"agent_id": agent_id, "status": "isolated", "timestamp": datetime.utcnow().isoformat()}

    async def get_vulnerabilities(self, agent_id: str) -> List[Dict]:
        response = await self.client.get(f"{self.base_url}/vulnerability/{agent_id}",
                                         auth=self.auth, params={"limit": 100})
        response.raise_for_status()
        return response.json().get("data", {}).get("affected_items", [])

    async def close(self):
        await self.client.aclose()
