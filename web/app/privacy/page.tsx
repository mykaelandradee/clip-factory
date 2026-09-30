import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade | Clip Factory",
  description: "Como o Clip Factory trata dados, arquivos e integrações.",
};

export default function PrivacyPage() {
  return (
    <main className="cf-legal-page">
      <article>
        <h1>Política de Privacidade</h1>
        <p className="cf-legal-updated">Última atualização: 30 de setembro de 2026</p>

        <h2>1. Sobre esta política</h2>
        <p>Esta política explica como o Clip Factory trata dados quando você utiliza a geração de clips, downloads, agendamentos ou integrações com plataformas externas.</p>

        <h2>2. Dados tratados</h2>
        <ul>
          <li>dados de conta necessários para autenticação, quando você faz login;</li>
          <li>URLs e configurações usadas para gerar clips;</li>
          <li>metadados técnicos dos processamentos, como status, configurações e horários;</li>
          <li>arquivos de vídeo gerados pelo serviço;</li>
          <li>dados necessários para conectar e publicar em contas do YouTube e Instagram, quando você autoriza essas integrações.</li>
        </ul>

        <h2>3. Como usamos os dados</h2>
        <p>Usamos esses dados para gerar clips, disponibilizar resultados e downloads, administrar agendamentos, publicar conteúdo solicitado pelo usuário, manter o serviço funcionando e proteger a infraestrutura contra abuso.</p>

        <h2>4. Integrações externas</h2>
        <p>Quando você conecta YouTube ou Instagram, o Clip Factory utiliza as permissões concedidas para executar as ações solicitadas. Tokens de acesso armazenados pelo serviço são protegidos no servidor e não são exibidos na interface.</p>

        <h2>5. Armazenamento e retenção</h2>
        <p>Os clips gerados são armazenados temporariamente no Cloudflare R2 e sujeitos a rotinas automáticas de limpeza. Os metadados dos processamentos possuem retenção planejada de até 90 dias. Esses períodos podem ser alterados conforme a operação do serviço.</p>

        <h2>6. Provedores de infraestrutura</h2>
        <p>O funcionamento do serviço utiliza provedores como Render, Supabase, GitHub Actions e Cloudflare R2. Informações podem ser processadas por esses provedores na medida necessária para executar o serviço.</p>

        <h2>7. Segurança</h2>
        <p>O Clip Factory utiliza autenticação, controles de propriedade dos jobs, tokens assinados para processamentos anônimos, limitação de requisições, criptografia de credenciais de integração e controles de acesso no banco de dados.</p>

        <h2>8. Desconexão e exclusão</h2>
        <p>Você pode desconectar as integrações disponibilizadas pelo Clip Factory. Para a integração com Instagram, o serviço também disponibiliza mecanismos de desautorização e solicitação de exclusão de dados.</p>

        <h2>9. Responsabilidade do usuário</h2>
        <p>Você é responsável pelos conteúdos que utiliza no serviço e deve possuir os direitos e autorizações necessários para processá-los e publicá-los.</p>

        <h2>10. Alterações</h2>
        <p>Esta política poderá ser atualizada quando houver mudanças relevantes no serviço, nas integrações ou nas obrigações aplicáveis. A data da última atualização será alterada quando isso ocorrer.</p>

        <h2>11. Contato</h2>
        <p>Para solicitações relacionadas à privacidade, utilize o canal de suporte oficialmente informado pelo Clip Factory.</p>

        <p className="cf-legal-note">Antes do lançamento público, substitua este texto pelo nome legal do responsável pelo serviço e pelo canal oficial de privacidade/suporte.</p>
      </article>
    </main>
  );
}
