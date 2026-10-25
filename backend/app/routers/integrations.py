from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime
from app.database import get_db
from app.models import Integration, User, AuditLog
from app.schemas import IntegrationCreate, IntegrationUpdate, IntegrationResponse, IntegrationTestResult
from app.core.security import get_current_user, require_role
from app.services.wazuh import WazuhService
from app.services.misp import MISPService
from app.services.elastic import ElasticService

router = APIRouter(prefix="/integrations", tags=["Integrations"])


@router.get("/", response_model=List[IntegrationResponse])
async def get_integrations(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Get all integrations (platform admin only)"""
    result = await db.execute(
        select(Integration).offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.get("/{integration_id}", response_model=IntegrationResponse)
async def get_integration(
    integration_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Get integration by ID"""
    result = await db.execute(select(Integration).where(Integration.id == integration_id))
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found"
        )
    
    return integration


@router.post("/", response_model=IntegrationResponse, status_code=status.HTTP_201_CREATED)
async def create_integration(
    integration_data: IntegrationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Create a new integration (platform admin only)"""
    new_integration = Integration(**integration_data.model_dump())
    db.add(new_integration)
    await db.commit()
    await db.refresh(new_integration)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        action="integration.created",
        resource="Integration",
        resource_id=str(new_integration.id),
        details=f"Created integration: {new_integration.name}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return new_integration


@router.patch("/{integration_id}", response_model=IntegrationResponse)
async def update_integration(
    integration_id: int,
    integration_data: IntegrationUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Update integration (platform admin only)"""
    result = await db.execute(select(Integration).where(Integration.id == integration_id))
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found"
        )
    
    # Update fields
    update_data = integration_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(integration, field, value)
    
    await db.commit()
    await db.refresh(integration)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        action="integration.updated",
        resource="Integration",
        resource_id=str(integration.id),
        details=f"Updated integration: {integration.name}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return integration


@router.post("/{integration_id}/test", response_model=IntegrationTestResult)
async def test_integration(
    integration_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Test integration connection (platform admin only)"""
    result = await db.execute(select(Integration).where(Integration.id == integration_id))
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found"
        )
    
    # Test connection based on integration name
    try:
        if integration.name == "Wazuh":
            service = WazuhService(
                base_url=integration.api_endpoint,
                api_user="admin",  # Should be stored in DB
                api_password=integration.api_key
            )
            agents = await service.get_agents()
            await service.close()
            
            result_msg = f"Successfully connected. Found {len(agents)} agents."
            
        elif integration.name == "MISP":
            service = MISPService(
                url=integration.api_endpoint,
                api_key=integration.api_key
            )
            events = await service.get_recent_events()
            await service.close()
            
            result_msg = f"Successfully connected. Found {len(events)} recent events."
            
        elif integration.name == "Elastic Security":
            service = ElasticService(
                url=integration.api_endpoint,
                api_key=integration.api_key
            )
            logs = await service.search_logs("error", size=10)
            await service.close()
            
            result_msg = f"Successfully connected. Found {len(logs)} recent logs."
            
        else:
            result_msg = "Integration test not implemented for this service."
        
        # Update last sync
        integration.last_sync = datetime.utcnow()
        integration.status = "active"
        await db.commit()
        
        # Log audit
        audit_log = AuditLog(
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_role=current_user.role,
            action="integration.tested",
            resource="Integration",
            resource_id=str(integration.id),
            details=f"Tested integration: {integration.name} - {result_msg}",
            ip_address=request.client.host if request.client else None,
            outcome="success"
        )
        db.add(audit_log)
        await db.commit()
        
        return IntegrationTestResult(
            success=True,
            message=result_msg
        )
        
    except Exception as e:
        # Log failed test
        audit_log = AuditLog(
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_role=current_user.role,
            action="integration.test_failed",
            resource="Integration",
            resource_id=str(integration.id),
            details=f"Failed to test integration: {integration.name} - {str(e)}",
            ip_address=request.client.host if request.client else None,
            outcome="failure"
        )
        db.add(audit_log)
        await db.commit()
        
        return IntegrationTestResult(
            success=False,
            message=f"Connection failed: {str(e)}"
        )


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    integration_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Delete integration (platform admin only)"""
    result = await db.execute(select(Integration).where(Integration.id == integration_id))
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found"
        )
    
    # Log audit before deletion
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        action="integration.deleted",
        resource="Integration",
        resource_id=str(integration.id),
        details=f"Deleted integration: {integration.name}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    
    await db.delete(integration)
    await db.commit()
    
    return None
