# AWS Lambda Python 3.12 公式ベースイメージ (ap-northeast-1 でも引ける public ECR)
FROM public.ecr.aws/lambda/python:3.12

# 依存パッケージ (Ragas + langchain-aws + boto3) のインストール
# pip キャッシュは Container 化時に不要なので --no-cache-dir で削減
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# ハンドラ本体
COPY handler.py ${LAMBDA_TASK_ROOT}/

# Lambda runtime が呼び出すエントリポイント (handler.py の lambda_handler 関数)
CMD ["handler.lambda_handler"]
