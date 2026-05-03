"""Bedrock Knowledge Base に対する retrieve-and-generate を呼び出す Lambda ハンドラ。

Lambda Function URL から POST リクエストを受け取る。
リクエスト: {"question": "質問文"}
レスポンス: {"answer": "回答文", "citations": [{"uri": "...", "page": N}, ...]}

環境変数:
  KNOWLEDGE_BASE_ID: Bedrock KB の ID
  MODEL_ARN: 回答生成に使う Inference Profile ARN (Claude Haiku/Sonnet 4.5)
"""

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

KB_ID: str = os.environ["KNOWLEDGE_BASE_ID"]
MODEL_ARN: str = os.environ["MODEL_ARN"]
AWS_REGION: str = os.environ.get("AWS_REGION", "ap-northeast-1")

bedrock_runtime = boto3.client("bedrock-agent-runtime", region_name=AWS_REGION)


def _build_response(
    status_code: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Lambda Function URL の標準レスポンス形式を組み立てる。

    Access-Control-Allow-Origin は Lambda Function URL の CORS 設定が
    自動付与するため、ここで定義すると応答ヘッダーが重複してブラウザが
    CORS エラーで fetch を失敗させる。Lambda コード側では Content-Type のみ。
    """
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def _extract_citations(response: dict[str, Any]) -> list[dict[str, Any]]:
    """retrieve-and-generate のレスポンスから引用元情報を取り出す。"""
    citations: list[dict[str, Any]] = []
    for cite in response.get("citations", []):
        for ref in cite.get("retrievedReferences", []):
            location = ref.get("location", {})
            s3_uri = location.get("s3Location", {}).get("uri", "")
            metadata = ref.get("metadata", {})
            citations.append(
                {
                    "uri": s3_uri,
                    "page": metadata.get("x-amz-bedrock-kb-document-page-number"),
                }
            )
    return citations


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda Function URL のエントリポイント。"""
    # Lambda Function URL は body を文字列で渡す (JSON 文字列の場合あり)
    raw_body = event.get("body", "{}")
    try:
        request = json.loads(raw_body) if isinstance(raw_body, str) else raw_body
    except json.JSONDecodeError:
        return _build_response(400, {"error": "Invalid JSON body"})

    question = (request.get("question") or "").strip()
    if not question:
        return _build_response(
            400,
            {"error": "question is required", "example": {"question": "..."}},
        )

    try:
        response = bedrock_runtime.retrieve_and_generate(
            input={"text": question},
            retrieveAndGenerateConfiguration={
                "type": "KNOWLEDGE_BASE",
                "knowledgeBaseConfiguration": {
                    "knowledgeBaseId": KB_ID,
                    "modelArn": MODEL_ARN,
                },
            },
        )
    except ClientError as e:
        # AWS API エラー (権限不足、KB未準備、ハードストップ発動など)
        error_code = e.response.get("Error", {}).get("Code", "UnknownError")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        return _build_response(
            502,
            {"error": f"Bedrock API error: {error_code}", "message": error_message},
        )

    return _build_response(
        200,
        {
            "answer": response["output"]["text"],
            "citations": _extract_citations(response),
            "sessionId": response.get("sessionId"),
        },
    )
