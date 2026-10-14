import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/action-form";
import { requireUser } from "@/lib/session";
import { listMembers } from "@/modules/core/members";
import { canAssignRole, canManageMember, INVITABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/modules/core/permissions";
import { removeMemberAction, revokeInvitationAction } from "./actions";
import { InviteForm, RoleSelect } from "./forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Membres" };

async function Members({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const { members, invitations, myRole } = await listMembers(user.id, companyId);
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
  const manage = canAssignRole(myRole, "viewer");
  const inviteRoles = INVITABLE_ROLES.filter((r) => canAssignRole(myRole, r)).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const assignable = ROLES.filter((r) => canAssignRole(myRole, r)).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Membres et rôles</h1>

      {manage && (
        <Card>
          <CardTitle hint="La personne rejoint cette entreprise uniquement. Vous restez maître de ses droits.">Inviter quelqu&apos;un</CardTitle>
          <InviteForm companyId={companyId} roles={inviteRoles} />
        </Card>
      )}

      <Card>
        <CardTitle>Membres ({members.length})</CardTitle>
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const me = m.userId === user.id;
            const editable = manage && canManageMember(myRole, m.role) && (!me || myRole === "owner");
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name} {me && <span className="text-xs font-normal text-muted">(vous)</span>}</p>
                  <p className="truncate text-xs text-muted">{m.email} · depuis le {fmt.format(m.joinedAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {editable ? <RoleSelect companyId={companyId} userId={m.userId} current={m.role} roles={assignable} /> : <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>}
                  {me ? (
                    <ActionButton variant="secondary" confirm="Quitter cette entreprise ? Vous perdrez l'accès à ses données." action={removeMemberAction.bind(null, companyId, m.userId)}>Quitter</ActionButton>
                  ) : (
                    manage && canManageMember(myRole, m.role) && <ActionButton variant="secondary" confirm={`Retirer ${m.name} de l'entreprise ?`} action={removeMemberAction.bind(null, companyId, m.userId)}>Retirer</ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {manage && invitations.length > 0 && (
        <Card>
          <CardTitle hint="Les liens ne sont affichés qu'à la création. En cas de perte, annulez l'invitation et créez-en une nouvelle.">Invitations en attente</CardTitle>
          <ul className="divide-y divide-border">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span><span className="font-medium">{i.email}</span><span className="block text-xs text-muted">{ROLE_LABELS[i.role]} · expire le {fmt.format(i.expiresAt)}</span></span>
                {canAssignRole(myRole, i.role) && <ActionButton variant="secondary" action={revokeInvitationAction.bind(null, companyId, i.id)}>Annuler</ActionButton>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Que peut faire chaque rôle ?</CardTitle>
        <dl className="space-y-3 text-sm">
          {ROLES.map((r) => (
            <div key={r}><dt className="font-medium">{ROLE_LABELS[r]}</dt><dd className="text-muted">{ROLE_DESCRIPTIONS[r]}</dd></div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

export default withAccess(Members);
