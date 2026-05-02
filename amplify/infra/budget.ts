import { Construct } from 'constructs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Budget + BudgetActions を作成するための入力。
 */
export interface BudgetProps {
    /** 予算超過時の通知メールアドレス */
    notificationEmail: string;
    /** 月額予算上限 (USD) */
    monthlyLimitUsd: number;
    /** 予算 100% 超過時にアタッチする Deny ポリシー */
    bedrockDenyPolicy: iam.ManagedPolicy;
    /** Deny ポリシーをアタッチする対象の IAM ロール (Lambda 実行ロール) */
    hardStopTargetRole: iam.Role;
}

export interface BudgetResources {
    budget: budgets.CfnBudget;
    action: budgets.CfnBudgetsAction;
    budgetActionRole: iam.Role;
}

/**
 * 月額予算 + アラート通知 + ハードストップアクションを作成する。
 *
 * - 50%, 80%, 100% で notificationEmail にメール通知 (ACTUAL ベース)
 * - 100% 超過時に bedrockDenyPolicy を hardStopTargetRole に自動アタッチ
 *   (AWS Budgets Actions、AUTOMATIC 実行)
 *
 * AWS Budgets Actions の挙動:
 * - executionRoleArn 経由で IAM 操作を行う
 * - approvalModel: AUTOMATIC は閾値到達時に即座にアクション実行
 * - 復旧時 (予算下回り) はアクション再実行されない (手動デタッチが必要)
 */
export const createBudgetWithHardStop = (
    scope: Construct,
    props: BudgetProps,
): BudgetResources => {
    const {
        notificationEmail,
        monthlyLimitUsd,
        bedrockDenyPolicy,
        hardStopTargetRole,
    } = props;

    const budgetName = 'chicken-knowledge-rag-monthly';

    // AWS Budgets Actions が IAM 操作するためのサービスロール
    const budgetActionRole = new iam.Role(scope, 'BudgetActionRole', {
        roleName: 'chicken-rag-budget-action-role',
        assumedBy: new iam.ServicePrincipal('budgets.amazonaws.com'),
        description:
            'AWS Budgets Actions が IAM ポリシーを Attach/Detach するためのロール',
    });
    budgetActionRole.addToPolicy(
        new iam.PolicyStatement({
            actions: ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'],
            resources: [hardStopTargetRole.roleArn],
        }),
    );
    budgetActionRole.addToPolicy(
        new iam.PolicyStatement({
            actions: ['iam:GetPolicy', 'iam:GetPolicyVersion'],
            resources: [bedrockDenyPolicy.managedPolicyArn],
        }),
    );

    // 通知サブスクライバー (3 段階のアラートで共通利用)
    const emailSubscriber: budgets.CfnBudget.SubscriberProperty = {
        subscriptionType: 'EMAIL',
        address: notificationEmail,
    };

    // 月額予算 + 50%/80%/100% アラート
    const budget = new budgets.CfnBudget(scope, 'MonthlyBudget', {
        budget: {
            budgetName,
            budgetType: 'COST',
            timeUnit: 'MONTHLY',
            budgetLimit: {
                amount: monthlyLimitUsd,
                unit: 'USD',
            },
        },
        notificationsWithSubscribers: [
            {
                notification: {
                    notificationType: 'ACTUAL',
                    comparisonOperator: 'GREATER_THAN',
                    threshold: 50,
                    thresholdType: 'PERCENTAGE',
                },
                subscribers: [emailSubscriber],
            },
            {
                notification: {
                    notificationType: 'ACTUAL',
                    comparisonOperator: 'GREATER_THAN',
                    threshold: 80,
                    thresholdType: 'PERCENTAGE',
                },
                subscribers: [emailSubscriber],
            },
            {
                notification: {
                    notificationType: 'ACTUAL',
                    comparisonOperator: 'GREATER_THAN',
                    threshold: 100,
                    thresholdType: 'PERCENTAGE',
                },
                subscribers: [emailSubscriber],
            },
        ],
    });

    // ハードストップ: 100% 超過時に Deny ポリシーを Lambda 実行ロールへ自動アタッチ
    const action = new budgets.CfnBudgetsAction(scope, 'HardStopAction', {
        budgetName,
        actionType: 'APPLY_IAM_POLICY',
        actionThreshold: {
            // CfnBudgetsAction.ActionThresholdProperty のプロパティ名は
            // type / value (CfnBudget.NotificationProperty とは別の構造)
            type: 'PERCENTAGE',
            value: 100,
        },
        approvalModel: 'AUTOMATIC',
        notificationType: 'ACTUAL',
        executionRoleArn: budgetActionRole.roleArn,
        definition: {
            iamActionDefinition: {
                policyArn: bedrockDenyPolicy.managedPolicyArn,
                roles: [hardStopTargetRole.roleName],
            },
        },
        subscribers: [
            // CfnBudgetsAction.SubscriberProperty は type / address
            // (CfnBudget.SubscriberProperty の subscriptionType / address とは別構造)
            { type: 'EMAIL', address: notificationEmail },
        ],
    });

    // BudgetActions は Budget 作成完了後に作成される必要がある
    action.addDependency(budget);

    return { budget, action, budgetActionRole };
};
