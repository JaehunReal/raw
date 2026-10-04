"""Read-only MCP access to the Mac's authenticated official-law gateway."""
import os
from pathlib import Path
from typing import Literal
import httpx
from mcp.server.fastmcp import FastMCP

config = Path(os.environ.get('RULECRAFT_GATEWAY_ENV', str(Path(__file__).resolve().parents[2] / '.gateway.env')))
settings = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line)
mcp = FastMCP('rulecraft_official_mcp')
annotations = {'readOnlyHint': True, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}

async def query(route, params=None):
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.get('http://127.0.0.1:8766/api/official/' + route,
            params=params, headers={'Authorization': 'Bearer ' + settings['RULECRAFT_GATEWAY_TOKEN']})
        if response.status_code != 200:
            raise ValueError('법령 조회 실패. 조회 조건 또는 로컬 서버 상태를 확인하세요.')
        return response.json()

@mcp.tool(annotations=annotations)
async def official_status() -> dict:
    """저장된 법령·행정규칙·자치법규의 문서 및 버전 건수를 조회합니다. 전수 완전성을 뜻하지 않습니다."""
    return await query('status')

@mcp.tool(annotations=annotations)
async def official_search(q: str, source: Literal['law','administrative','ordinance',''] = '', limit: int = 10, offset: int = 0) -> dict:
    """법령명으로 저장 버전을 검색합니다. limit 1~50, offset 0 이상. 본문 조회용 식별자를 반환합니다."""
    return await query('laws', {'q':q,'source':source,'limit':limit,'offset':offset})

@mcp.tool(annotations=annotations)
async def official_document(source: Literal['law','administrative','ordinance'], law_id: str, version_id: str) -> dict:
    """검색 결과의 정확한 식별자로 본문·출처·원문 해시를 조회합니다. 현재 법적 효력을 보증하지 않습니다."""
    return await query('document', {'source':source,'law_id':law_id,'version_id':version_id})

@mcp.tool(annotations=annotations)
async def official_graph(source: Literal['law','administrative','ordinance'], law_id: str, version_id: str) -> dict:
    """정확한 저장 버전의 법령명 인용·시행 근거 관계와 원문 증거를 조회합니다. 인용을 위임으로 간주하지 않습니다."""
    return await query('graph', {'source':source,'law_id':law_id,'version_id':version_id})

if __name__ == '__main__':
    mcp.run(transport='stdio')
