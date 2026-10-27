import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { registerAgentTools } from '../lib/webmcp';

/**
 * Renders nothing. Publishes the page's WebMCP tools (src/lib/webmcp.ts) for
 * agents that drive the browser, using the router so a tool call can move the
 * visible page. Does nothing in browsers without WebMCP.
 */
export function AgentBridge() {
    const navigate = useNavigate();
    const { i18n } = useTranslation();

    useEffect(() => registerAgentTools((to) => navigate(to), i18n.language), [navigate, i18n.language]);

    return null;
}
