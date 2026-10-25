from elasticsearch import AsyncElasticsearch
from typing import List, Dict, Optional
from datetime import datetime, timedelta


class ElasticService:
    """
    Elastic Security SIEM Integration
    
    Features:
    - Log search and correlation
    - Security case management
    - Threat detection rules
    - Dashboard integration
    """
    
    def __init__(self, url: str, api_key: str):
        self.es = AsyncElasticsearch(
            hosts=[url],
            api_key=api_key,
            request_timeout=30
        )
    
    async def search_logs(
        self,
        query: str,
        index: str = "logs-*",
        hours: int = 24,
        size: int = 100
    ) -> List[Dict]:
        """
        Search logs with full-text query
        
        Args:
            query: Search query (supports Lucene syntax)
            index: Index pattern
            hours: Time range
            size: Max results
        
        Returns:
            List of log documents
        """
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        body = {
            "query": {
                "bool": {
                    "must": [
                        {"query_string": {"query": query}}
                    ],
                    "filter": [
                        {
                            "range": {
                                "@timestamp": {
                                    "gte": start_time.isoformat() + "Z",
                                    "lte": end_time.isoformat() + "Z"
                                }
                            }
                        }
                    ]
                }
            },
            "size": size,
            "sort": [{"@timestamp": {"order": "desc"}}]
        }
        
        response = await self.es.search(index=index, body=body)
        
        return [
            {
                "id": hit["_id"],
                "timestamp": hit["_source"]["@timestamp"],
                "message": hit["_source"].get("message", ""),
                "source": hit["_source"].get("agent", {}).get("name", ""),
                "severity": hit["_source"].get("log", {}).get("level", "info"),
                "raw": hit["_source"]
            }
            for hit in response["hits"]["hits"]
        ]
    
    async def create_security_case(
        self,
        title: str,
        description: str,
        severity: str,
        assignee: str = None
    ) -> Dict:
        """
        Create security case in Elastic Security
        
        Args:
            title: Case title
            description: Case description
            severity: low/medium/high/critical
            assignee: Username
        
        Returns:
            Created case object
        """
        case = {
            "title": title,
            "description": description,
            "severity": severity,
            "status": "open",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "created_by": "infracentra"
        }
        
        if assignee:
            case["assignee"] = assignee
        
        response = await self.es.index(
            index=".siem-signals-default",
            body=case,
            refresh=True
        )
        
        return {
            "id": response["_id"],
            "title": title,
            "severity": severity,
            "status": "open"
        }
    
    async def get_cases(
        self,
        status: str = "open",
        severity: str = None
    ) -> List[Dict]:
        """
        Get security cases
        
        Args:
            status: Filter by status
            severity: Filter by severity
        
        Returns:
            List of cases
        """
        query = {
            "bool": {
                "must": [
                    {"term": {"status": status}}
                ]
            }
        }
        
        if severity:
            query["bool"]["must"].append({"term": {"severity": severity}})
        
        response = await self.es.search(
            index=".siem-signals-default",
            body={"query": query, "size": 100}
        )
        
        return [
            {
                "id": hit["_id"],
                "title": hit["_source"]["title"],
                "description": hit["_source"]["description"],
                "severity": hit["_source"]["severity"],
                "status": hit["_source"]["status"],
                "created_at": hit["_source"]["created_at"]
            }
            for hit in response["hits"]["hits"]
        ]
    
    async def close(self):
        """Close Elasticsearch client"""
        await self.es.close()
