const usersPerPage = 1000;

export async function listAllAccessFixtureUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.listUsers({
      page,
      perPage: usersPerPage,
    });
    if (error) throw error;
    if (!Array.isArray(data?.users)) {
      throw new Error("Access fixture auth-user data is invalid");
    }
    users.push(...data.users);
    if (data.users.length < usersPerPage) return users;
  }
}

function normalizePhone(phone) {
  return typeof phone === "string" ? phone.replace(/^\+/, "") : null;
}

export function findAccessFixtureUser(users, phone) {
  const fixturePhone = normalizePhone(phone);
  return users.find((user) => normalizePhone(user.phone) === fixturePhone);
}
