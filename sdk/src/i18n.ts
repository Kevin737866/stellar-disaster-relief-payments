/**
 * Internationalization (i18n) Module
 * Provides localized error messages and notifications in multiple languages
 */

export type Language = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ja' | 'zh' | 'ar' | 'hi';

export interface ErrorMessage {
  code: string;
  message: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
}

export interface LocalizedErrorMessages {
  [language: string]: {
    [errorCode: string]: ErrorMessage;
  };
}

/**
 * Complete error message translations
 */
export const ERROR_MESSAGES: LocalizedErrorMessages = {
  en: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'Fund is not active',
      description: 'The requested fund is no longer active or has been suspended.',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient funds in pool',
      description: 'The fund does not have enough available balance to process this request.',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'Insufficient signatures',
      description: 'The required number of authorizations has not been met.',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'Unauthorized approver',
      description: 'The approver is not authorized to perform this action.',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'Recall not enabled for this fund',
      description: 'The fund has not been configured to allow fund recall.',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'Fund is not yet eligible for recall',
      description: 'The fund must age for the specified period before recall is allowed.',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'Fund transfer failed',
      description: 'Unable to transfer funds between the specified accounts.',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'Invalid fund ID',
      description: 'The specified fund ID does not exist or is invalid.',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'Duplicate disbursement detected',
      description: 'This beneficiary has already received a disbursement for this purpose.',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'Transaction failed',
      description: 'The blockchain transaction could not be processed.',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'Failed to send notification',
      description: 'The notification system could not deliver the message.',
      severity: 'error',
    },
  },
  es: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'El fondo no está activo',
      description: 'El fondo solicitado ya no está activo o ha sido suspendido.',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Fondos insuficientes',
      description: 'El fondo no tiene suficiente saldo disponible para procesar esta solicitud.',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'Firmas insuficientes',
      description: 'El número requerido de autorizaciones no se ha cumplido.',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'Aprobador no autorizado',
      description: 'El aprobador no está autorizado para realizar esta acción.',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'Recuperación no habilitada para este fondo',
      description: 'El fondo no ha sido configurado para permitir la recuperación de fondos.',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'El fondo aún no es elegible para recuperación',
      description: 'El fondo debe envejecer durante el período especificado antes de permitir la recuperación.',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'Falló la transferencia de fondos',
      description: 'No se pudo transferir fondos entre las cuentas especificadas.',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'ID de fondo inválido',
      description: 'El ID de fondo especificado no existe o es inválido.',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'Desembolso duplicado detectado',
      description: 'Este beneficiario ya ha recibido un desembolso para este propósito.',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'La transacción falló',
      description: 'La transacción en blockchain no pudo ser procesada.',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'No se pudo enviar la notificación',
      description: 'El sistema de notificación no pudo entregar el mensaje.',
      severity: 'error',
    },
  },
  fr: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'Le fonds n\'est pas actif',
      description: 'Le fonds demandé n\'est plus actif ou a été suspendu.',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Fonds insuffisants',
      description: 'Le fonds n\'a pas suffisamment de solde disponible pour traiter cette demande.',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'Signatures insuffisantes',
      description: 'Le nombre requis d\'autorisations n\'a pas été atteint.',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'Approbateur non autorisé',
      description: 'L\'approbateur n\'est pas autorisé à effectuer cette action.',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'Récupération non activée pour ce fonds',
      description: 'Le fonds n\'a pas été configuré pour permettre la récupération de fonds.',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'Le fonds n\'est pas encore eligible pour la récupération',
      description: 'Le fonds doit mûrir pendant la période spécifiée avant de permettre la récupération.',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'Le transfert de fonds a échoué',
      description: 'Impossible de transférer les fonds entre les comptes spécifiés.',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'ID de fonds invalide',
      description: 'L\'ID de fonds spécifié n\'existe pas ou est invalide.',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'Débours en double détecté',
      description: 'Ce bénéficiaire a déjà reçu un débours pour ce but.',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'La transaction a échoué',
      description: 'La transaction blockchain n\'a pas pu être traitée.',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'Échec de l\'envoi de la notification',
      description: 'Le système de notification n\'a pas pu livrer le message.',
      severity: 'error',
    },
  },
  de: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'Fonds ist nicht aktiv',
      description: 'Der angeforderte Fonds ist nicht mehr aktiv oder wurde ausgesetzt.',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Unzureichende Mittel',
      description: 'Der Fonds verfügt nicht über ausreichende verfügbare Deckung für diese Anfrage.',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'Unzureichende Signaturen',
      description: 'Die erforderliche Anzahl von Genehmigungen wurde nicht erreicht.',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'Nicht autorisierter Genehmiger',
      description: 'Der Genehmiger ist nicht berechtigt, diese Aktion auszuführen.',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'Rückruf ist für diesen Fonds nicht aktiviert',
      description: 'Der Fonds wurde nicht konfiguriert, um Fondsrückrufe zu ermöglichen.',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'Fonds ist noch nicht zum Rückruf berechtigt',
      description: 'Der Fonds muss für den angegebenen Zeitraum reifen, bevor Rückruf erlaubt ist.',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'Fondsübertragung fehlgeschlagen',
      description: 'Fonds konnten nicht zwischen den angegebenen Konten übertragen werden.',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'Ungültige Fonds-ID',
      description: 'Die angegebene Fonds-ID existiert nicht oder ist ungültig.',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'Doppelte Auszahlung erkannt',
      description: 'Dieser Begünstigte hat bereits eine Auszahlung für diesen Zweck erhalten.',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'Transaktion fehlgeschlagen',
      description: 'Die Blockchain-Transaktion konnte nicht verarbeitet werden.',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'Benachrichtigung konnte nicht gesendet werden',
      description: 'Das Benachrichtigungssystem konnte die Nachricht nicht zustellen.',
      severity: 'error',
    },
  },
  pt: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'O fundo não está ativo',
      description: 'O fundo solicitado não está mais ativo ou foi suspenso.',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Fundos insuficientes',
      description: 'O fundo não tem saldo disponível suficiente para processar esta solicitação.',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'Assinaturas insuficientes',
      description: 'O número necessário de autorizações não foi alcançado.',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'Aprovador não autorizado',
      description: 'O aprovador não está autorizado a realizar esta ação.',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'Recall não habilitado para este fundo',
      description: 'O fundo não foi configurado para permitir recuperação de fundos.',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'O fundo ainda não é elegível para recuperação',
      description: 'O fundo deve envelhecer durante o período especificado antes de permitir recuperação.',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'Falha na transferência de fundos',
      description: 'Não foi possível transferir fundos entre as contas especificadas.',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'ID do fundo inválido',
      description: 'O ID de fundo especificado não existe ou é inválido.',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'Desembolso duplicado detectado',
      description: 'Este beneficiário já recebeu um desembolso para esta finalidade.',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'Falha na transação',
      description: 'A transação blockchain não pôde ser processada.',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'Falha ao enviar notificação',
      description: 'O sistema de notificação não conseguiu entregar a mensagem.',
      severity: 'error',
    },
  },
  ja: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'ファンドがアクティブではありません',
      description: 'リクエストされたファンドはアクティブではなくなったか、中止されました。',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: '資金不足',
      description: 'ファンドにはこのリクエストを処理するための利用可能な残高が不足しています。',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: '署名不足',
      description: '必要な認可数に達していません。',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: '認可されていない承認者',
      description: '承認者はこのアクションを実行する権限がありません。',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'このファンドではリコールが有効になっていません',
      description: 'ファンドはリコールを許可するように設定されていません。',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'ファンドはまだリコール対象ではありません',
      description: 'リコールを許可する前に、ファンドは指定された期間経過する必要があります。',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'ファンド転送に失敗しました',
      description: '指定されたアカウント間でファンドを転送できませんでした。',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: '無効なファンドID',
      description: '指定されたファンドIDは存在しないか無効です。',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: '重複した支払いが検出されました',
      description: 'この受益者はすでにこの目的で支払いを受け取っています。',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'トランザクション失敗',
      description: 'ブロックチェーントランザクションを処理できませんでした。',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: '通知の送信に失敗しました',
      description: '通知システムがメッセージを配信できませんでした。',
      severity: 'error',
    },
  },
  zh: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: '基金不活跃',
      description: '请求的基金不再活跃或已被暂停。',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: '资金不足',
      description: '基金没有足够的可用余额来处理此请求。',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: '签名不足',
      description: '未达到所需的授权数。',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: '未授权的批准者',
      description: '批准者无权执行此操作。',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: '未为此基金启用召回',
      description: '基金尚未配置为允许基金召回。',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: '基金还不符合召回条件',
      description: '基金必须在指定期间内达到年龄后才能允许召回。',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: '基金转账失败',
      description: '无法在指定账户之间转账。',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: '无效的基金ID',
      description: '指定的基金ID不存在或无效。',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: '检测到重复支付',
      description: '该受益人已为此目的收到了支付。',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: '交易失败',
      description: '无法处理区块链交易。',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: '通知发送失败',
      description: '通知系统无法传递消息。',
      severity: 'error',
    },
  },
  ar: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'الصندوق غير نشط',
      description: 'الصندوق المطلوب لم يعد نشطًا أو تم تعليقه.',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'أموال غير كافية',
      description: 'الصندوق لا يملك رصيدًا متاحًا كافيًا لمعالجة هذا الطلب.',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'توقيعات غير كافية',
      description: 'لم يتم الوصول إلى العدد المطلوب من التفويضات.',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'موافق غير مصرح',
      description: 'الموافق غير مصرح بإجراء هذا الإجراء.',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'الاستدعاء غير مفعل لهذا الصندوق',
      description: 'لم يتم تكوين الصندوق للسماح باستدعاء الأموال.',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'الصندوق غير مؤهل بعد للاستدعاء',
      description: 'يجب أن ينضج الصندوق للفترة المحددة قبل السماح بالاستدعاء.',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'فشل تحويل الأموال',
      description: 'تعذر تحويل الأموال بين الحسابات المحددة.',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'معرف صندوق غير صالح',
      description: 'معرف الصندوق المحدد غير موجود أو غير صالح.',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'تم اكتشاف صرف مكرر',
      description: 'قد تلقى هذا المستفيد بالفعل صرفًا لهذا الغرض.',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'فشلت المعاملة',
      description: 'تعذر معالجة معاملة blockchain.',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'فشل إرسال الإشعار',
      description: 'تعذر على نظام الإخطارات توصيل الرسالة.',
      severity: 'error',
    },
  },
  hi: {
    FUND_NOT_ACTIVE: {
      code: 'FUND_NOT_ACTIVE',
      message: 'फंड सक्रिय नहीं है',
      description: 'अनुरोधित फंड अब सक्रिय नहीं है या निलंबित कर दिया गया है।',
      severity: 'error',
    },
    INSUFFICIENT_FUNDS: {
      code: 'INSUFFICIENT_FUNDS',
      message: 'अपर्याप्त धनराशि',
      description: 'फंड के पास इस अनुरोध को संसाधित करने के लिए पर्याप्त उपलब्ध शेष नहीं है।',
      severity: 'error',
    },
    INVALID_SIGNATURES: {
      code: 'INVALID_SIGNATURES',
      message: 'अपर्याप्त हस्ताक्षर',
      description: 'आवश्यक संख्या में प्राधिकार प्राप्त नहीं हुए।',
      severity: 'error',
    },
    UNAUTHORIZED_APPROVER: {
      code: 'UNAUTHORIZED_APPROVER',
      message: 'अनुमति प्राप्त न किया गया अनुमोदनकर्ता',
      description: 'अनुमोदनकर्ता को यह कार्य करने के लिए अनुमति नहीं है।',
      severity: 'error',
    },
    RECALL_NOT_ENABLED: {
      code: 'RECALL_NOT_ENABLED',
      message: 'इस फंड के लिए रिकॉल सक्षम नहीं है',
      description: 'फंड को फंड रिकॉल की अनुमति देने के लिए कॉन्फ़िगर नहीं किया गया है।',
      severity: 'error',
    },
    FUND_NOT_ELIGIBLE_FOR_RECALL: {
      code: 'FUND_NOT_ELIGIBLE_FOR_RECALL',
      message: 'फंड अभी तक रिकॉल के लिए योग्य नहीं है',
      description: 'रिकॉल की अनुमति देने से पहले फंड को निर्दिष्ट अवधि के लिए परिपक्व होना चाहिए।',
      severity: 'error',
    },
    TRANSFER_FAILED: {
      code: 'TRANSFER_FAILED',
      message: 'फंड ट्रांसफर विफल',
      description: 'निर्दिष्ट खातों के बीच फंड ट्रांसफर नहीं हो सके।',
      severity: 'error',
    },
    INVALID_FUND_ID: {
      code: 'INVALID_FUND_ID',
      message: 'अमान्य फंड आईडी',
      description: 'निर्दिष्ट फंड आईडी मौजूद नहीं है या अमान्य है।',
      severity: 'error',
    },
    DUPLICATE_DISBURSEMENT: {
      code: 'DUPLICATE_DISBURSEMENT',
      message: 'डुप्लिकेट वितरण का पता चला',
      description: 'इस लाभार्थी को इसी उद्देश्य के लिए पहले से वितरण प्राप्त हो चुका है।',
      severity: 'warning',
    },
    TRANSACTION_FAILED: {
      code: 'TRANSACTION_FAILED',
      message: 'लेनदेन विफल',
      description: 'ब्लॉकचेन लेनदेन को संसाधित नहीं किया जा सका।',
      severity: 'error',
    },
    NOTIFICATION_FAILED: {
      code: 'NOTIFICATION_FAILED',
      message: 'अधिसूचना भेजने में विफल',
      description: 'सूचना प्रणाली संदेश प्रदान नहीं कर सकी।',
      severity: 'error',
    },
  },
};

/**
 * i18n Manager for handling error messages in multiple languages
 */
export class I18nManager {
  private currentLanguage: Language;
  private fallbackLanguage: Language = 'en';

  constructor(language: Language = 'en') {
    this.currentLanguage = language;
  }

  /**
   * Set the current language
   */
  setLanguage(language: Language): void {
    this.currentLanguage = language;
  }

  /**
   * Get the current language
   */
  getLanguage(): Language {
    return this.currentLanguage;
  }

  /**
   * Get error message by code
   */
  getErrorMessage(errorCode: string): ErrorMessage {
    const messages = ERROR_MESSAGES[this.currentLanguage];
    
    if (messages && messages[errorCode]) {
      return messages[errorCode];
    }
    
    // Fallback to English if language not available
    const fallbackMessages = ERROR_MESSAGES[this.fallbackLanguage];
    if (fallbackMessages && fallbackMessages[errorCode]) {
      return fallbackMessages[errorCode];
    }
    
    // Return generic error if code not found
    return {
      code: errorCode,
      message: `Error: ${errorCode}`,
      description: 'An unknown error occurred',
      severity: 'error',
    };
  }

  /**
   * Get localized error message string
   */
  getMessage(errorCode: string): string {
    return this.getErrorMessage(errorCode).message;
  }

  /**
   * Get localized error description
   */
  getDescription(errorCode: string): string {
    return this.getErrorMessage(errorCode).description;
  }

  /**
   * Get all available languages
   */
  getAvailableLanguages(): Language[] {
    return Object.keys(ERROR_MESSAGES) as Language[];
  }

  /**
   * Get all error codes
   */
  getAvailableErrorCodes(): string[] {
    const codes = new Set<string>();
    for (const languageMessages of Object.values(ERROR_MESSAGES)) {
      for (const code of Object.keys(languageMessages)) {
        codes.add(code);
      }
    }
    return Array.from(codes);
  }

  /**
   * Format error message with parameters
   */
  formatError(errorCode: string, params?: Record<string, string>): string {
    let message = this.getMessage(errorCode);
    
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        message = message.replace(`{${key}}`, value);
      }
    }
    
    return message;
  }
}

// Create a default instance
export const defaultI18n = new I18nManager('en');
