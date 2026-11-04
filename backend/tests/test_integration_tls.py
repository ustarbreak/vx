"""Regression tests for secure defaults on outbound integration clients."""
from unittest.mock import MagicMock

import pytest


def test_wazuh_tls_verification_enabled_by_default(monkeypatch):
    import app.services.wazuh as module

    captured = {}
    class Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)
    monkeypatch.setattr(module.httpx, "AsyncClient", Client)

    module.WazuhService("https://wazuh.example", "user", "secret")
    assert captured["verify"] is True


def test_misp_tls_verification_enabled_by_default(monkeypatch):
    import app.services.misp as module

    captured = {}
    def pymisp(*args, **kwargs):
        captured.update(kwargs)
        return MagicMock()
    monkeypatch.setattr(module, "PyMISP", pymisp)

    module.MISPService("https://misp.example", "secret")
    assert captured["ssl"] is True


def test_elastic_tls_verification_enabled_by_default(monkeypatch):
    import app.services.elastic as module

    captured = {}
    def client(**kwargs):
        captured.update(kwargs)
        return MagicMock()
    monkeypatch.setattr(module, "AsyncElasticsearch", client)

    module.ElasticService("https://elastic.example", "secret")
    assert captured["verify_certs"] is True
    assert captured["ca_certs"] is None


def test_elastic_accepts_private_ca_bundle(monkeypatch):
    import app.services.elastic as module

    captured = {}
    def client(**kwargs):
        captured.update(kwargs)
        return MagicMock()
    monkeypatch.setattr(module, "AsyncElasticsearch", client)

    module.ElasticService("https://elastic.example", "secret",
                          ca_certs="/etc/ssl/customer-ca.pem")
    assert captured["verify_certs"] is True
    assert captured["ca_certs"] == "/etc/ssl/customer-ca.pem"
