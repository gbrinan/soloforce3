/**
 * React Email 템플릿
 * Resend + @react-email/components 기반
 */
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Img,
  Preview,
} from "@react-email/components";

// ============================================
// 서명 요청 이메일
// ============================================

interface SigningRequestEmailProps {
  signerName: string;
  senderName: string;
  documentName: string;
  signingUrl: string;
  expiresAt?: string;
  message?: string;
}

export function SigningRequestEmail({
  signerName,
  senderName,
  documentName,
  signingUrl,
  expiresAt,
  message,
}: SigningRequestEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Preview>
        {senderName}님이 &quot;{documentName}&quot; 문서의 서명을
        요청했습니다.
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={logoStyle}>MySign</Text>
          <Hr style={hrStyle} />

          <Text style={headingStyle}>서명 요청</Text>

          <Text style={textStyle}>
            안녕하세요, {signerName}님.
          </Text>
          <Text style={textStyle}>
            <strong>{senderName}</strong>님이 &quot;
            <strong>{documentName}</strong>&quot; 문서의 서명을
            요청했습니다.
          </Text>

          {message && (
            <Section style={messageBoxStyle}>
              <Text style={messageTextStyle}>{message}</Text>
            </Section>
          )}

          <Section style={buttonSectionStyle}>
            <Button style={buttonStyle} href={signingUrl}>
              문서 확인 및 서명하기
            </Button>
          </Section>

          {expiresAt && (
            <Text style={noteStyle}>
              이 서명 요청은 {expiresAt}까지 유효합니다.
            </Text>
          )}

          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            본 이메일은 MySign 전자서명 플랫폼에서 발송되었습니다.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ============================================
// 서명 완료 이메일
// ============================================

interface SigningCompleteEmailProps {
  signerName: string;
  documentName: string;
  completedAt: string;
  downloadUrl: string;
}

export function SigningCompleteEmail({
  signerName,
  documentName,
  completedAt,
  downloadUrl,
}: SigningCompleteEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Preview>&quot;{documentName}&quot; 문서의 서명이 완료되었습니다.</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={logoStyle}>MySign</Text>
          <Hr style={hrStyle} />

          <Text style={headingStyle}>서명 완료</Text>

          <Text style={textStyle}>
            안녕하세요, {signerName}님.
          </Text>
          <Text style={textStyle}>
            &quot;<strong>{documentName}</strong>&quot; 문서의 모든 서명이
            완료되었습니다.
          </Text>
          <Text style={textStyle}>완료 일시: {completedAt}</Text>

          <Section style={buttonSectionStyle}>
            <Button style={buttonStyle} href={downloadUrl}>
              서명된 문서 다운로드
            </Button>
          </Section>

          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            본 이메일은 MySign 전자서명 플랫폼에서 발송되었습니다.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ============================================
// 서명 리마인더 이메일
// ============================================

interface SigningReminderEmailProps {
  signerName: string;
  senderName: string;
  documentName: string;
  signingUrl: string;
  expiresAt?: string;
}

export function SigningReminderEmail({
  signerName,
  senderName,
  documentName,
  signingUrl,
  expiresAt,
}: SigningReminderEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Preview>
        &quot;{documentName}&quot; 문서의 서명이 아직 완료되지 않았습니다.
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={logoStyle}>MySign</Text>
          <Hr style={hrStyle} />

          <Text style={headingStyle}>서명 리마인더</Text>

          <Text style={textStyle}>
            안녕하세요, {signerName}님.
          </Text>
          <Text style={textStyle}>
            <strong>{senderName}</strong>님이 요청한 &quot;
            <strong>{documentName}</strong>&quot; 문서의 서명이 아직
            완료되지 않았습니다.
          </Text>

          <Section style={buttonSectionStyle}>
            <Button style={buttonStyle} href={signingUrl}>
              지금 서명하기
            </Button>
          </Section>

          {expiresAt && (
            <Text style={noteStyle}>
              서명 기한: {expiresAt}
            </Text>
          )}

          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            본 이메일은 MySign 전자서명 플랫폼에서 발송되었습니다.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ============================================
// 공통 스타일
// ============================================

const bodyStyle = {
  backgroundColor: "#FAFAFA",
  fontFamily:
    "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const containerStyle = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 32px",
  maxWidth: "560px",
  borderRadius: "10px",
};

const logoStyle = {
  fontSize: "28px",
  fontWeight: "700" as const,
  color: "#04070F",
  textAlign: "center" as const,
  margin: "0 0 16px 0",
};

const headingStyle = {
  fontSize: "20px",
  fontWeight: "600" as const,
  color: "#04070F",
  margin: "24px 0 16px 0",
};

const textStyle = {
  fontSize: "14px",
  lineHeight: "24px",
  color: "#13295F",
  margin: "0 0 8px 0",
};

const messageBoxStyle = {
  backgroundColor: "#F0F2F5",
  borderRadius: "6px",
  padding: "16px",
  margin: "16px 0",
  borderLeft: "3px solid #4F46E5",
};

const messageTextStyle = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#13295F",
  fontStyle: "italic" as const,
  margin: "0",
};

const buttonSectionStyle = {
  textAlign: "center" as const,
  margin: "28px 0",
};

const buttonStyle = {
  backgroundColor: "#04070F",
  borderRadius: "6px",
  color: "#ffffff",
  fontWeight: "600" as const,
  fontSize: "14px",
  padding: "12px 32px",
  textDecoration: "none",
};

const noteStyle = {
  fontSize: "12px",
  color: "#6E7278",
  textAlign: "center" as const,
};

const hrStyle = {
  borderColor: "#DFE1E5",
  margin: "20px 0",
};

const footerStyle = {
  fontSize: "12px",
  color: "#6E7278",
  textAlign: "center" as const,
  margin: "0",
};
