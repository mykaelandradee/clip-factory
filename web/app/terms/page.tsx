import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso | Clip Factory",
  description: "Termos de uso do Clip Factory.",
};

export default function TermsPage() {
  return (
    <main className="cf-legal-page">
      <article>
        <h1>Termos de Uso</h1>
        <p className="cf-legal-updated">Última atualização: 30 de setembro de 2026</p>

        <h2>1. Aceitação</h2>
        <p>Ao utilizar o Clip Factory, você concorda com estes Termos de Uso e com a Política de Privacidade.</p>

        <h2>2. O serviço</h2>
        <p>O Clip Factory oferece ferramentas automatizadas para transformar vídeos em clips curtos, gerar legendas e, quando autorizado pelo usuário, publicar ou agendar conteúdo em plataformas integradas.</p>

        <h2>3. Conteúdo do usuário</h2>
        <p>Você é responsável pelos vídeos, áudios, imagens, textos e demais materiais utilizados no serviço. Você declara possuir as autorizações e direitos necessários para processar, transformar e publicar esse conteúdo.</p>

        <h2>4. YouTube e Instagram</h2>
        <p>As integrações dependem das APIs, permissões, políticas e disponibilidade das respectivas plataformas. O usuário é responsável pelas contas conectadas e pelas ações realizadas por meio delas.</p>

        <h2>5. Uso proibido</h2>
        <p>Não é permitido utilizar o serviço para atividades ilícitas, fraude, violação de direitos de terceiros, abuso das APIs, tentativa de contornar controles de segurança ou qualquer finalidade proibida pelas plataformas integradas.</p>

        <h2>6. Agendamentos</h2>
        <p>Um agendamento depende da disponibilidade do serviço e das plataformas integradas. O usuário pode cancelar agendamentos enquanto essa opção estiver disponível. A publicação final pode depender de processamento e regras da plataforma de destino.</p>

        <h2>7. Arquivos e retenção</h2>
        <p>Arquivos temporários e metadados podem ser removidos automaticamente conforme as rotinas de retenção do serviço. O usuário deve manter cópias dos materiais que deseja preservar.</p>

        <h2>8. Disponibilidade</h2>
        <p>O serviço depende de infraestrutura e APIs de terceiros e pode sofrer indisponibilidade, limitações, alterações ou interrupções. Não há garantia de disponibilidade contínua.</p>

        <h2>9. Segurança e abuso</h2>
        <p>Podem ser aplicados limites de requisições e outros controles para proteger o serviço, seus usuários e os provedores de infraestrutura.</p>

        <h2>10. Alterações</h2>
        <p>Estes termos podem ser atualizados para refletir mudanças no produto, na infraestrutura ou nos requisitos aplicáveis.</p>

        <h2>11. Contato</h2>
        <p>Para suporte ou questões relacionadas ao serviço, utilize o canal oficial informado pelo Clip Factory.</p>

        <p className="cf-legal-note">Antes do lançamento público, substitua este texto pelos dados legais do responsável pelo serviço e pelo canal oficial de suporte.</p>
      </article>
    </main>
  );
}
