"""
Ragas 評価パイプライン Lambda (Issue #17)

月次 (EventBridge Scheduler) または手動 invoke で起動し、
本番 chat-handler の応答品質を Ragas 4指標で測定する。

応答生成方式は「案 C」: chat-handler Lambda を直接 invoke して本番一致の
応答を取得する。Issue 本文の RetrieveAndGenerate 案 (案 A) は #18 で導入した
リスク階層 systemPrompt を反映できないため不採用 (knowledge.md 参照)。

入出力:
- 入力 (event): EventBridge Scheduler / 手動 invoke いずれも空 dict
- 出力: { statusCode, runId, overall: {metric_name: score} }

評価結果の保存先:
- DynamoDB EvaluationResults: PK=runId, SK=metricName
- S3 evaluation-bucket/results/{runId}.json: 質問単位の詳細ログ
"""
import json
import os
from datetime import datetime
from typing import Any

import boto3
from langchain_aws import BedrockEmbeddings, ChatBedrockConverse
from ragas import EvaluationDataset, SingleTurnSample, evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import (
    AnswerRelevancy,
    ContextPrecision,
    ContextRecall,
    Faithfulness,
)

# 環境変数 (CDK が backend.ts で配線)
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
KB_ID = os.environ["KNOWLEDGE_BASE_ID"]
MODEL_ID = os.environ["MODEL_ID"]  # 例: global.anthropic.claude-sonnet-4-6
EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0"  # KB と同じ Titan V2
CHAT_HANDLER_FUNCTION_NAME = os.environ["CHAT_HANDLER_FUNCTION_NAME"]
EVALUATION_BUCKET = os.environ["EVALUATION_BUCKET"]
TESTSET_KEY = os.environ.get("TESTSET_KEY", "testset/v1.json")
RESULTS_TABLE_NAME = os.environ["RESULTS_TABLE_NAME"]

# Ragas が認識する標準4指標のカラム名 (Pandas DataFrame から抽出する際に使う)
METRIC_COLUMNS = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)

s3 = boto3.client("s3", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
agent_client = boto3.client("bedrock-agent-runtime", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)


def retrieve_contexts(question: str) -> list[str]:
    """
    chat-handler と同じ KB に Retrieve API を呼んでチャンクテキストを取得する。

    chat-handler のレスポンスには citations (uri / page) しか含まれず、
    Ragas が必要とするチャンク本文がないため、evaluation-handler 側で
    並行 Retrieve する。chat-handler と同じ KB / numberOfResults=5 を使うので
    取得結果は実質同一 (LLM 判断は介在しないため決定論的)。
    """
    resp = agent_client.retrieve(
        knowledgeBaseId=KB_ID,
        retrievalQuery={"text": question},
        retrievalConfiguration={
            "vectorSearchConfiguration": {"numberOfResults": 5}
        },
    )
    return [
        result.get("content", {}).get("text", "")
        for result in resp.get("retrievalResults", [])
    ]


def invoke_chat_handler(question: str) -> str:
    """
    chat-handler Lambda を直接 invoke して回答テキストを取得する。

    AppSync resolver イベント形式 ({ arguments: {...} }) を再現することで、
    chat-handler 側の改修なしに本番ロジックをそのまま呼び出す。
    会話履歴 (historyJson / summary) は None で渡し、各質問を独立した単発質問として
    評価する (履歴の影響を排除してベースラインを純粋に測るため)。
    """
    payload = {
        "arguments": {
            "question": question,
            "historyJson": None,
            "summary": None,
        }
    }
    resp = lambda_client.invoke(
        FunctionName=CHAT_HANDLER_FUNCTION_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )
    body = json.loads(resp["Payload"].read().decode("utf-8"))
    if "errorMessage" in body:
        raise RuntimeError(
            f"chat-handler invoke failed: {body.get('errorMessage')}"
        )
    return body.get("answer", "")


def build_samples(testset: dict[str, Any]) -> list[SingleTurnSample]:
    """testset.json の各 item を Ragas SingleTurnSample に変換する"""
    samples: list[SingleTurnSample] = []
    items = testset.get("items", [])
    for idx, item in enumerate(items, start=1):
        question = item["user_input"]
        print(f"[{idx}/{len(items)}] processing: {question[:50]}...")
        retrieved = retrieve_contexts(question)
        answer = invoke_chat_handler(question)
        samples.append(
            SingleTurnSample(
                user_input=question,
                response=answer,
                retrieved_contexts=retrieved,
                reference=item.get("reference"),
                reference_contexts=item.get("reference_contexts"),
            )
        )
    return samples


def write_results_to_dynamodb(
    run_id: str,
    overall: dict[str, float],
    per_question: list[dict[str, Any]],
    testset_version: str,
    system_prompt_version: str,
) -> None:
    """
    EvaluationResults テーブルに run_id 単位で書き込む。

    PK=runId / SK=metricName のスキーマで:
    - 全体スコア: SK が指標名 (faithfulness / answer_relevancy 等)
    - 質問単位スコア: SK が question_001 形式、score に JSON 化した
      4指標スコア・details に質問本文と応答抜粋を格納
    """
    table = dynamodb.Table(RESULTS_TABLE_NAME)
    timestamp = datetime.utcnow().isoformat()

    for metric_name, score in overall.items():
        table.put_item(
            Item={
                "runId": run_id,
                "metricName": metric_name,
                "score": str(score),
                "timestamp": timestamp,
                "testsetVersion": testset_version,
                "systemPromptVersion": system_prompt_version,
                "modelId": MODEL_ID,
            }
        )

    for idx, q in enumerate(per_question, start=1):
        table.put_item(
            Item={
                "runId": run_id,
                "metricName": f"question_{idx:03d}",
                "score": json.dumps(q.get("scores", {})),
                "timestamp": timestamp,
                "testsetVersion": testset_version,
                "systemPromptVersion": system_prompt_version,
                "modelId": MODEL_ID,
                "details": json.dumps(
                    {
                        "question": q.get("user_input", "")[:300],
                        "response": q.get("response", "")[:1000],
                    },
                    ensure_ascii=False,
                ),
            }
        )


def archive_to_s3(run_id: str, per_question: list[dict[str, Any]]) -> None:
    """質問単位の詳細ログを S3 results/{runId}.json にアーカイブする"""
    s3.put_object(
        Bucket=EVALUATION_BUCKET,
        Key=f"results/{run_id}.json",
        Body=json.dumps(
            per_question, ensure_ascii=False, default=str
        ).encode("utf-8"),
        ContentType="application/json",
    )


def lambda_handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    print(f"Starting evaluation: testset_key={TESTSET_KEY}, model={MODEL_ID}")

    # 1. testset.json を S3 から読込
    obj = s3.get_object(Bucket=EVALUATION_BUCKET, Key=TESTSET_KEY)
    testset = json.loads(obj["Body"].read().decode("utf-8"))
    testset_version = testset.get("version", "unknown")
    system_prompt_version = testset.get("system_prompt_version", "unknown")
    print(
        f"Loaded testset: version={testset_version}, "
        f"system_prompt_version={system_prompt_version}, "
        f"items={len(testset.get('items', []))}"
    )

    # 2. 各質問に対して chat-handler invoke + 並行 Retrieve でサンプル構築
    samples = build_samples(testset)
    print(f"Built {len(samples)} samples, starting Ragas evaluation...")

    # 3. Ragas で4指標計算 (Sonnet 4.6 をジャッジに、Titan V2 を embedding に)
    judge_llm = LangchainLLMWrapper(
        ChatBedrockConverse(model=MODEL_ID, region_name=REGION)
    )
    embeddings = LangchainEmbeddingsWrapper(
        BedrockEmbeddings(
            model_id=EMBEDDING_MODEL_ID, region_name=REGION
        )
    )

    dataset = EvaluationDataset(samples=samples)
    result = evaluate(
        dataset=dataset,
        metrics=[
            Faithfulness(),
            AnswerRelevancy(),
            ContextPrecision(),
            ContextRecall(),
        ],
        llm=judge_llm,
        embeddings=embeddings,
    )

    # 4. 結果整形: 全体平均 + 質問単位
    df = result.to_pandas()
    available_metrics = [c for c in METRIC_COLUMNS if c in df.columns]
    overall = {m: float(df[m].mean()) for m in available_metrics}
    per_question = [
        {
            "user_input": str(row.get("user_input", "")),
            "response": str(row.get("response", "")),
            "scores": {m: float(row[m]) for m in available_metrics},
        }
        for _, row in df.iterrows()
    ]

    run_id = f"run_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    # 5. DynamoDB 書込 + S3 アーカイブ
    write_results_to_dynamodb(
        run_id, overall, per_question, testset_version, system_prompt_version
    )
    archive_to_s3(run_id, per_question)

    print(f"Evaluation complete: runId={run_id}, overall={overall}")
    return {
        "statusCode": 200,
        "runId": run_id,
        "overall": overall,
    }
