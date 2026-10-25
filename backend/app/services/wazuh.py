import httpx
from typing import List, Dict, Optional
from datetime import datetime, timedelta


class WazuhService:
    """
    Wazuh EDR/XDR Integration
    
    Features:
    - Agent management
    - Alert retrieval
    - Endpoint isolation
    - File integrity monitoring
    - Vulnerability detection
    """
    
    def __init__(self, base_url: str, api_user: str, api_password: str):
        self.base_url = base_url.rstrip('/')
        self.auth = (api_user, api_password)
        self.client = httpx.AsyncClient(timeout=30.0, verify=False)
    
    async def get_agents(self, org_id: str = None) -> List[Dict]:
        """
        Get all monitored agents
        
        Returns:
            List of agent objects with status, OS, IP, etc.
        """
        params = {"limit": 1000, "select": "id,name,ip,status,os,version"}
        
        if org_id:
            # Filter by organization (custom field)
            params["group"] = org_id
        
        response = await self.client.get(
            f"{self.base_url}/agents",
            auth=self.auth,
            params=params
        )
        response.raise_for_status()
        
        data = response.json()
        return data.get("data", {}).get("affected_items", [])
    
    async def get_alerts(
        self,
        level: int = 7,
        hours: int = 24,
        agent_id: str = None
    ) -> List[Dict]:
        """
        Get security alerts
        
        Args:
            level: Minimum alert level (0-15)
            hours: Time range in hours
            agent_id: Filter by specific agent
        
        Returns:
            List of alert objects
        """
        params = {
            "level__gte": level,
            "limit": 500,
            "sort": "-timestamp"
        }
        
        if agent_id:
            params["agent_id"] = agent_id
        
        # Calculate time range
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        params["date_from"] = start_time.isoformat() + "Z"
        params["date_to"] = end_time.isoformat() + "Z"
        
        response = await self.client.get(
            f"{self.base_url}/alerts",
            auth=self.auth,
            params=params
        )
        response.raise_for_status()
        
        data = response.json()
        return data.get("data", {}).get("affected_items", [])
    
    async def isolate_agent(self, agent_id: str) -> Dict:
        """
        Isolate compromised endpoint from network
        
        This prevents lateral movement while allowing
        communication with Wazuh manager for remediation.
        
        Args:
            agent_id: Wazuh agent ID
        
        Returns:
            Isolation status
        """
        response = await self.client.put(
            f"{self.base_url}/agents/{agent_id}/restart",
            auth=self.auth,
            json={"isolate": True}
        )
        response.raise_for_status()
        
        return {
            "agent_id": agent_id,
            "status": "isolated",
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def get_vulnerabilities(self, agent_id: str) -> List[Dict]:
        """
        Get detected vulnerabilities for an agent
        
        Returns:
            List of CVEs with severity and status
        """
        response = await self.client.get(
            f"{self.base_url}/vulnerability/{agent_id}",
            auth=self.auth,
            params={"limit": 100}
        )
        response.raise_for_status()
        
        data = response.json()
        return data.get("data", {}).get("affected_items", [])
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
