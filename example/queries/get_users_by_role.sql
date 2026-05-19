SELECT id AS "id!", name AS "name!", email AS "email!"
FROM users
WHERE role = $1
ORDER BY id
LIMIT $2::int
